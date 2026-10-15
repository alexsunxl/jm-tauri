use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

#[derive(Clone, Serialize)]
pub(crate) struct ReaderNetworkProgress {
    phase: &'static str,
    bytes: u64,
}

pub(crate) struct ReaderNetworkReporter {
    channel: Option<tauri::ipc::Channel<ReaderNetworkProgress>>,
    pending_bytes: u64,
    last_report: Instant,
}

impl ReaderNetworkReporter {
    pub(crate) fn new(channel: Option<tauri::ipc::Channel<ReaderNetworkProgress>>) -> Self {
        let reporter = Self {
            channel,
            pending_bytes: 0,
            last_report: Instant::now(),
        };
        reporter.send("start", 0);
        reporter
    }

    fn send(&self, phase: &'static str, bytes: u64) {
        if let Some(channel) = &self.channel {
            let _ = channel.send(ReaderNetworkProgress { phase, bytes });
        }
    }

    pub(crate) fn received(&mut self, bytes: usize) {
        self.pending_bytes += bytes as u64;
        if self.last_report.elapsed() >= Duration::from_millis(250) {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if self.pending_bytes > 0 {
            self.send("progress", self.pending_bytes);
            self.pending_bytes = 0;
        }
        self.last_report = Instant::now();
    }
}

impl Drop for ReaderNetworkReporter {
    fn drop(&mut self) {
        self.flush();
        self.send("end", 0);
    }
}

/// Keep the same in-flight future while checking cancellation, including when
/// the server sends no headers or body chunks. Dropping it aborts that request.
pub(crate) async fn cancelable<F: Future>(
    future: F,
    token: Option<&AtomicBool>,
) -> Result<F::Output, String> {
    let Some(token) = token else {
        return Ok(future.await);
    };
    let mut future = std::pin::pin!(future);
    loop {
        if token.load(Ordering::Relaxed) {
            return Err("cancelled".to_string());
        }
        if let Ok(result) = tokio::time::timeout(Duration::from_millis(250), future.as_mut()).await
        {
            return Ok(result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn reporter_flushes_remaining_bytes_and_closes_on_drop() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let collected = messages.clone();
        let channel = tauri::ipc::Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                panic!("expected JSON telemetry");
            };
            collected
                .lock()
                .unwrap()
                .push(serde_json::from_str::<serde_json::Value>(&json).unwrap());
            Ok(())
        });
        {
            let mut reporter = ReaderNetworkReporter::new(Some(channel));
            reporter.received(100);
            reporter.received(200);
        }
        let messages = messages.lock().unwrap();
        assert_eq!(messages.first().unwrap()["phase"], "start");
        assert_eq!(messages.last().unwrap()["phase"], "end");
        let bytes: u64 = messages
            .iter()
            .filter(|message| message["phase"] == "progress")
            .map(|message| message["bytes"].as_u64().unwrap())
            .sum();
        assert_eq!(bytes, 300);
    }

    #[test]
    fn stalled_network_wait_can_be_canceled_without_receiving_data() {
        tauri::async_runtime::block_on(async {
            let token = Arc::new(AtomicBool::new(false));
            let cancel_token = token.clone();
            let cancellation = tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(10)).await;
                cancel_token.store(true, Ordering::Relaxed);
            });
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                cancelable(std::future::pending::<()>(), Some(&token)),
            )
            .await
            .expect("cancellation must not wait for the network timeout");
            assert_eq!(result, Err("cancelled".to_string()));
            cancellation.await.unwrap();
        });
    }

    #[test]
    fn network_wait_preserves_the_original_result() {
        tauri::async_runtime::block_on(async {
            let token = AtomicBool::new(false);
            assert_eq!(cancelable(async { 42 }, Some(&token)).await, Ok(42));
            assert_eq!(cancelable(async { 42 }, None).await, Ok(42));
        });
    }
}

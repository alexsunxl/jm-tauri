use serde::{Deserialize, Serialize};
use serde_json::Value;

const TAG_CACHE_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Serialize, Deserialize)]
struct CachedTags {
    tags: Vec<String>,
    updated_at: i64,
}

pub(crate) struct AlbumTagCache(sled::Tree);

/// Missing/malformed tags are unknown, while an explicit [] is complete data.
pub(crate) fn extract_tags(album: &Value) -> Option<Vec<String>> {
    let values = album.get("tags")?.as_array()?;
    let mut tags = Vec::new();
    for value in values {
        let tag = value.as_str()?.trim();
        if !tag.is_empty() && !tags.iter().any(|existing| existing == tag) {
            tags.push(tag.to_string());
        }
    }
    Some(tags)
}

pub(crate) fn is_fresh(updated_at: i64, now: i64) -> bool {
    updated_at > 0 && now >= updated_at && now - updated_at < TAG_CACHE_TTL_MS
}

impl AlbumTagCache {
    pub(crate) fn open() -> Result<Self, String> {
        super::read_progress_db()?
            .open_tree("album_tags_v1")
            .map(Self)
            .map_err(|e| format!("open album tags cache failed: {e}"))
    }

    fn entry(&self, aid: &str) -> Option<CachedTags> {
        let bytes = self.0.get(aid.as_bytes()).ok()??;
        serde_json::from_slice(&bytes).ok()
    }

    pub(crate) fn get(&self, aid: &str, now: i64) -> Option<Vec<String>> {
        let entry = self.entry(aid)?;
        is_fresh(entry.updated_at, now).then_some(entry.tags)
    }

    pub(crate) fn fallback(&self, aid: &str) -> Option<Vec<String>> {
        self.entry(aid).map(|entry| entry.tags)
    }

    pub(crate) fn store_album(
        &self,
        aid: &str,
        album: &Value,
        updated_at: i64,
    ) -> Result<(), String> {
        let Some(tags) = extract_tags(album) else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(&CachedTags { tags, updated_at })
            .map_err(|e| format!("encode album tags failed: {e}"))?;
        let mut ids = vec![aid.to_string()];
        for field in ["id", "series_id"] {
            if let Some(value) = album.get(field) {
                let id = match value {
                    Value::String(id) => id.trim().to_string(),
                    Value::Number(id) => id.to_string(),
                    _ => continue,
                };
                if !id.is_empty() && id != "0" && !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        let mut batch = sled::Batch::default();
        for id in ids {
            batch.insert(id.as_bytes(), bytes.as_slice());
        }
        self.0
            .apply_batch(batch)
            .map_err(|e| format!("cache album tags failed: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tags_must_be_complete_and_are_counted_once_per_work() {
        assert_eq!(extract_tags(&json!({})), None);
        assert_eq!(extract_tags(&json!({"tags": null})), None);
        assert_eq!(extract_tags(&json!({"tags": ["完结", 123]})), None);
        assert_eq!(extract_tags(&json!({"tags": []})), Some(vec![]));
        assert_eq!(
            extract_tags(&json!({"tags": [" 完结 ", "完结", "", "女性向"]})),
            Some(vec!["完结".into(), "女性向".into()])
        );
    }

    #[test]
    fn cache_resolves_entry_album_and_work_ids_without_changing_favorites_schema() {
        let db = sled::Config::new().temporary(true).open().unwrap();
        let cache = AlbumTagCache(db.open_tree("tags").unwrap());
        cache
            .store_album(
                "202",
                &json!({"id": 202, "series_id": "100", "tags": ["完结"]}),
                1000,
            )
            .unwrap();
        for id in ["100", "202"] {
            assert_eq!(cache.get(id, 1001), Some(vec!["完结".into()]));
            assert_eq!(cache.get(id, 1000 + TAG_CACHE_TTL_MS), None);
            assert_eq!(cache.fallback(id), Some(vec!["完结".into()]));
        }
        cache
            .store_album("300", &json!({"tags": []}), 1000)
            .unwrap();
        assert_eq!(cache.get("300", 1001), Some(vec![]));
        assert_eq!(cache.get("missing", 1001), None);
    }
}

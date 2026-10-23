package com.aa.jm

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallApkArgs {
  lateinit var path: String
}

/**
 * 应用内 APK 安装插件：
 * 通过 FileProvider 生成 content:// URI，携带 FLAG_GRANT_READ_URI_PERMISSION
 * 发起 ACTION_VIEW 安装 intent。依赖 manifest 中的 REQUEST_INSTALL_PACKAGES
 * 与 res/xml/file_paths.xml 的路径覆盖（jm-updates/）。
 */
@TauriPlugin
class UpdateApkPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallApkArgs::class.java)
      val file = File(args.path)
      if (!file.exists()) {
        invoke.reject("file not found: ${args.path}")
        return
      }
      val uri: Uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "install failed")
    }
  }
}

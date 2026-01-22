# APK 构建说明

## JDK 版本
JDK 版本不要太新，建议使用 17：
```
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export PATH="$JAVA_HOME/bin:$PATH"
java -version
```

示例输出：
```
openjdk version "17.0.17" 2025-10-21
OpenJDK Runtime Environment (build 17.0.17+10)
OpenJDK 64-Bit Server VM (build 17.0.17+10, mixed mode, sharing)
```

## 构建 APK
```
cargo tauri android build
```

## 开发阶段构建（不改版本文件）
在 `jm` 目录运行：
```
pnpm apk:dev
```
说明：
- 临时注入 `versionName`/`versionCode`，不修改 `tauri.conf.json`。
- `versionName` 形如 `0.1.25-dev.YYYYMMDDHHmm.g<hash>`，`versionCode` 使用时间戳，确保可覆盖安装。

## 签名才能安装（已配置自动签名）
```
$ANDROID_SDK_ROOT/build-tools/35.0.0/apksigner sign \
  --ks jm/jm-release.keystore \
  --ks-key-alias jmkey \
  --out app-universal-release-signed.apk \
  jm/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

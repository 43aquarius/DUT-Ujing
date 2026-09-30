/**
 * Expo 本地配置插件（App 构建定制）
 *
 * 1) withReleaseSigning —— 为 Android release 构建注入正式签名
 *    读取仓库内 keys/release.keystore（个人使用场景，密钥与口令随仓库分发），
 *    在 prebuild 生成的 android/app/build.gradle 末尾追加签名块。
 *    Gradle 允许多个 android{} 配置块，后配置的 release 签名覆盖默认 debug 签名，
 *    无需修改 Expo 模板原有内容，升级兼容性最好。
 *    口令可通过环境变量覆盖：UJING_STORE_PASSWORD / UJING_KEY_ALIAS / UJING_KEY_PASSWORD
 *
 * 2) withStrippedPermissions —— 移除 Expo 模板/expo-camera 带入的无关权限
 *    （录音/存储/悬浮窗/振动），只保留 CAMERA + INTERNET。
 *    用 tools:node="remove" 同时拦截库清单的合并（expo-camera 会声明 RECORD_AUDIO）。
 */

const { withAppBuildGradle, withAndroidManifest } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "// ---- dut-ujing release signing (injected by plugins/withReleaseSigning) ----";

/** 本应用不需要的权限（扫码只需相机 + 网络） */
const STRIP_PERMISSIONS = [
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.VIBRATE",
];

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) {
      return cfg; // 幂等：已注入则跳过
    }

    const keystorePath = path.join(cfg.modRequest.projectRoot, "keys", "release.keystore");
    if (!fs.existsSync(keystorePath)) {
      console.warn(
        "[withReleaseSigning] 未找到 keys/release.keystore，跳过注入（release 将回退 debug 签名）"
      );
      return cfg;
    }

    cfg.modResults.contents = `${contents}

${MARKER}
// 多个 android{} 块按顺序生效：此处为 release 覆盖为正式签名
android {
    signingConfigs {
        release {
            storeFile file("../../keys/release.keystore")
            storePassword System.getenv("UJING_STORE_PASSWORD") ?: "DUTujing2026!"
            keyAlias System.getenv("UJING_KEY_ALIAS") ?: "ujing"
            keyPassword System.getenv("UJING_KEY_PASSWORD") ?: "DUTujing2026!"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
`;
    return cfg;
  });
}

function withStrippedPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    // modResults 是 xml2js 解析出的文档对象：{ manifest: { $, 'uses-permission', application, ... } }
    const manifest = cfg.modResults.manifest;
    if (!manifest) {
      console.warn("[withStrippedPermissions] 清单结构异常，跳过权限裁剪");
      return cfg;
    }

    // 声明 tools 命名空间（tools:node 属性需要）
    manifest.$ = manifest.$ || {};
    if (!manifest.$["xmlns:tools"]) {
      manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }

    // 1) 删除模板主清单里的普通声明
    const perms = Array.isArray(manifest["uses-permission"])
      ? manifest["uses-permission"]
      : [];
    manifest["uses-permission"] = perms.filter(
      (p) => !STRIP_PERMISSIONS.includes(p?.$?.["android:name"])
    );

    // 2) 以 tools:node="remove" 重新登记，拦截库清单合并
    //    （expo-camera 的 AndroidManifest 会声明 RECORD_AUDIO）
    for (const name of STRIP_PERMISSIONS) {
      manifest["uses-permission"].push({
        $: { "android:name": name, "tools:node": "remove" },
      });
    }

    console.log(
      "[withStrippedPermissions] 已移除无关权限:",
      STRIP_PERMISSIONS.join(", ")
    );
    return cfg;
  });
}

function withAndroidBuildConfig(config) {
  return withStrippedPermissions(withReleaseSigning(config));
}

module.exports = withAndroidBuildConfig;

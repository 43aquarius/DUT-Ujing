plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dut.ujing.helper"
    compileSdk = 35

    defaultConfig {
        // 与 v1.0.0 (Expo) 保持一致：老用户可直接覆盖升级
        applicationId = "com.dut.ujing.helper"
        minSdk = 24
        targetSdk = 35
        versionCode = 3
        versionName = "2.1.0"
    }

    signingConfigs {
        create("release") {
            // 复用 v1.0.0 的签名密钥（仓库内 keys/release.keystore，个人项目随仓库分发）
            storeFile = file("../keys/release.keystore")
            storePassword = System.getenv("UJING_STORE_PASSWORD") ?: "DUTujing2026!"
            keyAlias = System.getenv("UJING_KEY_ALIAS") ?: "ujing"
            keyPassword = System.getenv("UJING_KEY_PASSWORD") ?: "DUTujing2026!"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    // 只用最精简的一组：无 RN/无 Compose/无 hilt → APK 目标 5-7MB
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // 纯 Java 二维码识别 + 自带扫码 Activity（无 native so，不占 ABI 体积）
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}

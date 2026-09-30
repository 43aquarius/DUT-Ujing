# R8 混淆补充规则（okhttp/kotlin/material 均自带 consumer rules，这里只做兜底）
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**

# zxing-embedded 通过资源/反射加载部分类，保守保留
-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }

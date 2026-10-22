import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Push notifications need the Firebase config (google-services.json, never committed: CI writes it
// from the GOOGLE_SERVICES_JSON secret). The plugin fails the build without it, so it is only applied
// when the file is there - until then the app builds and simply has no push.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Release signing. CI writes android/key.properties (and the keystore) from
// repository secrets; without it, release builds fall back to the debug key.
val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
if (hasReleaseKey) keystoreProperties.load(FileInputStream(keystorePropertiesFile))

android {
    namespace = "app.inframe.inframe"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "app.inframe.android"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // From pubspec / --build-name and --build-number (CI sets them from the release tag + run number).
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Sign-in (flutter_appauth): the identity server redirects back to
        // app.inframe.android:/oauth2redirect. Lowercase, and the same as applicationId.
        manifestPlaceholders.putAll(mapOf("appAuthRedirectScheme" to "app.inframe.android"))
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

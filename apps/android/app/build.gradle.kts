import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Signing details live outside the repository.
 *
 * Android identifies an app by its signing key for the app's entire life: a key
 * that leaks lets someone else publish a replacement, and a key that is lost
 * cannot be rotated — the only way forward is a new listing under a new package
 * name, abandoning every installed user. So the keystore and its passwords stay
 * in ~/.tradezaki and never enter git.
 *
 * When the file is absent the release build falls back to unsigned, so a fresh
 * clone still builds rather than failing with something cryptic.
 */
val keystoreProps = Properties().apply {
    val f = File(System.getProperty("user.home"), ".tradezaki/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasSigning = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "app.tradezaki.mobile"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.tradezaki.mobile"
        // 24 covers ~97% of active devices and is where WebView stops needing
        // workarounds. Going lower costs more than those users are worth here.
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    if (hasSigning) {
        signingConfigs {
            create("release") {
                storeFile = File(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // Nothing to shrink worth the risk: the app is one activity, and
            // R8 stripping a WebView callback is a bug that only shows up on a
            // user's phone.
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
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
        viewBinding = false
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}

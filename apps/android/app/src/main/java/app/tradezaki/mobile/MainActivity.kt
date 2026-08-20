package app.tradezaki.mobile

import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * Tradezaki in a WebView.
 *
 * A shell, on purpose — see README. Everything below exists because a naive
 * WebView gets one of these wrong and the app feels broken in a way users
 * blame on the product rather than the wrapper.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private lateinit var refresher: SwipeRefreshLayout

    /**
     * Hosts the app is allowed to render inside itself.
     *
     * Deriv's login is included because OAuth has to complete in the same
     * WebView to land back on our callback with its cookies intact. Anything
     * else — a support link, a Deriv marketing page — opens in the real browser
     * instead, so people are never stranded in a chromeless window with no way
     * back and no address bar to check what they are looking at.
     */
    private val internalHosts = setOf(
        "tradezaki.vercel.app",
        "auth.deriv.com",
        "oauth.deriv.com",
        "login.deriv.com",
    )

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.web)
        refresher = findViewById(R.id.refresher)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // the app uses localStorage for preferences
            databaseEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            // Let the page decide its own text size; the site is already
            // responsive and Android's own scaling fights it.
            textZoom = 100
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // The Deriv session is an httpOnly cookie. Without persistence it is
        // dropped the moment the app is closed, and the user is asked to log in
        // again every single launch.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val host = request.url.host ?: return false
                if (internalHosts.any { host == it || host.endsWith(".$it") }) return false
                // External: hand to the browser.
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                refresher.isRefreshing = false
                // Flush now rather than on a timer: Android may kill the process
                // without warning, and a lost session cookie means a fresh login.
                CookieManager.getInstance().flush()
            }
        }

        // The web app manufactures CSV exports with a blob: URL, which a WebView
        // will not save on its own — the download would simply do nothing.
        web.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(this, "Open the site in a browser to export files.", Toast.LENGTH_LONG).show()
                return@setDownloadListener
            }
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setMimeType(mimeType)
                addRequestHeader("cookie", CookieManager.getInstance().getCookie(url))
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        }

        refresher.setOnRefreshListener { web.reload() }
        // Pull-to-refresh must only trigger at the very top, or every attempt to
        // scroll a chart or a long trade list reloads the page instead.
        refresher.setOnChildScrollUpCallback { _: SwipeRefreshLayout, _: View? -> web.scrollY > 0 }

        // Back should walk the app's own history first. Without this the first
        // back press exits, which after drilling into a bot feels like a crash.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl(START_URL) else web.restoreState(savedInstanceState)
    }

    // Survives rotation without throwing away the page and the user's place in it.
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    companion object {
        const val START_URL = "https://tradezaki.vercel.app/trade"
    }
}

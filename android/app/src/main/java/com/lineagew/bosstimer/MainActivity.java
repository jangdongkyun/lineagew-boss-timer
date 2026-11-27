package com.lineagew.bosstimer;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final int OVERLAY_PERMISSION_REQUEST = 4201;
    private static final String APP_URL = "https://jangdongkyun.github.io/lineagew-boss-timer/";
    private WebView webView;
    private boolean waitingForOverlayPermission = false;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new NativeBridge(), "BossTimerNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript("(function(){var b=document.getElementById('miniPopupBtn');if(!b||b.dataset.nativeBound)return;b.dataset.nativeBound='1';b.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();BossTimerNative.openFloatingMini();},true);})();", null);
            }
        });
        setContentView(webView);
        if (state == null) webView.loadUrl(APP_URL); else webView.restoreState(state);
    }
    private class NativeBridge {
        @JavascriptInterface public void openFloatingMini() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(MainActivity.this)) {
                    waitingForOverlayPermission = true;
                    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                    startActivityForResult(i, OVERLAY_PERMISSION_REQUEST);
                } else startFloatingWindow();
            });
        }
    }
    private void startFloatingWindow() {
        Intent i = new Intent(this, FloatingWindowService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OVERLAY_PERMISSION_REQUEST && Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(this)) startFloatingWindow();
        waitingForOverlayPermission = false;
    }
    @Override protected void onResume() {
        super.onResume();
        if (waitingForOverlayPermission && Build.VERSION.SDK_INT >= 23 && Settings.canDrawOverlays(this)) {
            waitingForOverlayPermission = false; startFloatingWindow();
        }
    }
    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); if (webView != null) webView.saveState(out); }
    @Override protected void onDestroy() { if (webView != null) webView.destroy(); super.onDestroy(); }
}

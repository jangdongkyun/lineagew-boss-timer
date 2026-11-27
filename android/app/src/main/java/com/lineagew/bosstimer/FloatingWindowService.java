package com.lineagew.bosstimer;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class FloatingWindowService extends Service {
    private static final String CHANNEL_ID = "boss_floating_window";
    private WindowManager windowManager;
    private View floatingView;
    private WindowManager.LayoutParams params;

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        startForeground(101, buildNotification());
        showFloatingWindow();
    }
    private void showFloatingWindow() {
        if (floatingView != null) return;
        windowManager = (WindowManager)getSystemService(WINDOW_SERVICE);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(15,19,29));
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10),dp(7),dp(6),dp(7));
        bar.setBackgroundColor(Color.rgb(28,35,49));
        TextView title = new TextView(this);
        title.setText("LINEAGE W · 보탐봇"); title.setTextColor(Color.WHITE); title.setTextSize(13); title.setTypeface(null,1);
        bar.addView(title,new LinearLayout.LayoutParams(0,dp(38),1));
        Button home = new Button(this); home.setText("메인"); home.setTextSize(11);
        bar.addView(home,new LinearLayout.LayoutParams(dp(54),dp(38)));
        home.setOnClickListener(v -> {
            Intent i = new Intent(this,MainActivity.class); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(i); stopSelf();
        });
        Button close = new Button(this); close.setText("✕"); close.setTextSize(12);
        bar.addView(close,new LinearLayout.LayoutParams(dp(44),dp(38)));
        close.setOnClickListener(v -> stopSelf());
        bar.setOnTouchListener(new View.OnTouchListener() {
            int sx,sy; float tx,ty;
            @Override public boolean onTouch(View v,MotionEvent e) {
                if(e.getAction()==MotionEvent.ACTION_DOWN){sx=params.x;sy=params.y;tx=e.getRawX();ty=e.getRawY();return true;}
                if(e.getAction()==MotionEvent.ACTION_MOVE){params.x=sx+(int)(e.getRawX()-tx);params.y=sy+(int)(e.getRawY()-ty);windowManager.updateViewLayout(floatingView,params);return true;}
                return true;
            }
        });
        WebView mini = new WebView(this); mini.setBackgroundColor(Color.rgb(15,19,29));
        WebSettings ws=mini.getSettings(); ws.setJavaScriptEnabled(true); ws.setDomStorageEnabled(true); ws.setDatabaseEnabled(true); ws.setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(mini,true);
        mini.setWebChromeClient(new WebChromeClient());
        mini.loadUrl("https://jangdongkyun.github.io/lineagew-boss-timer/mini.html");
        root.addView(bar);
        root.addView(mini,new LinearLayout.LayoutParams(-1,0,1));
        params=new WindowManager.LayoutParams(dp(330),dp(470),
            Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.END; params.x=dp(12); params.y=dp(100);
        floatingView=root; windowManager.addView(floatingView,params);
    }
    private Notification buildNotification() {
        Intent open=new Intent(this,MainActivity.class);
        PendingIntent pi=PendingIntent.getActivity(this,0,open,PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE:0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder.setContentTitle("보탐봇 미니 창 실행 중")
            .setContentText("알림을 눌러 메인 보탐봇을 열 수 있습니다.")
            .setSmallIcon(android.R.drawable.ic_dialog_info).setContentIntent(pi).setOngoing(true).build();
    }
    private void createNotificationChannel() {
        if(Build.VERSION.SDK_INT>=26){NotificationChannel c=new NotificationChannel(CHANNEL_ID,"보탐봇 플로팅 창",NotificationManager.IMPORTANCE_LOW);getSystemService(NotificationManager.class).createNotificationChannel(c);}
    }
    private int dp(int v){return (int)(v*getResources().getDisplayMetrics().density);}
    @Override public int onStartCommand(Intent intent,int flags,int id){if(floatingView==null)showFloatingWindow();return START_STICKY;}
    @Override public void onDestroy(){if(floatingView!=null&&windowManager!=null){windowManager.removeView(floatingView);floatingView=null;}stopForeground(true);super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}

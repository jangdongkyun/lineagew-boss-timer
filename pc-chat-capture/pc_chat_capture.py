import hashlib, json, re, threading, time
from datetime import datetime, timezone
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import cv2, mss, numpy as np, pytesseract, requests

APP_DIR=Path(__file__).resolve().parent
CONFIG_PATH=APP_DIR/"config.json"
BRIDGE_URL="https://jswekbrsjkylrwhgvvre.supabase.co/functions/v1/game-chat-bridge"
DEFAULT={"tesseract_path":r"C:\Program Files\Tesseract-OCR\tesseract.exe","device_token":"","server_id":1,"region":None,"poll_seconds":1.2,"auto_send":False}
COMMAND_RE=re.compile(r"^(컷|취소)\s+(.+?)\s+([0-2]?\d):([0-5]\d)$")

def load_config():
    try:
        return {**DEFAULT,**json.loads(CONFIG_PATH.read_text(encoding="utf-8"))}
    except Exception:
        return DEFAULT.copy()

def save_config(cfg):
    CONFIG_PATH.write_text(json.dumps(cfg,ensure_ascii=False,indent=2),encoding="utf-8")

def green_ratio(img,x,y,w,h):
    crop=img[max(0,y):max(0,y+h),max(0,x):max(0,x+w)]
    if crop.size==0:return 0.0
    hsv=cv2.cvtColor(crop,cv2.COLOR_BGR2HSV)
    mask=cv2.inRange(hsv,np.array([32,55,65]),np.array([100,255,255]))
    return float(np.count_nonzero(mask))/float(mask.size)

def extract_green_text(img):
    rgb=cv2.cvtColor(img,cv2.COLOR_BGR2RGB)
    d=pytesseract.image_to_data(rgb,lang="kor+eng",config="--oem 3 --psm 6",output_type=pytesseract.Output.DICT)
    groups={}
    for i,word in enumerate(d["text"]):
        word=str(word).strip()
        if not word:continue
        k=(d["block_num"][i],d["par_num"][i],d["line_num"][i])
        groups.setdefault(k,[]).append({"text":word,"x":d["left"][i],"y":d["top"][i],"w":d["width"][i],"h":d["height"][i]})
    out=[]
    for words in groups.values():
        words.sort(key=lambda a:a["x"])
        x1=min(a["x"] for a in words); y1=min(a["y"] for a in words)
        x2=max(a["x"]+a["w"] for a in words); y2=max(a["y"]+a["h"] for a in words)
        ratio=green_ratio(img,x1,y1,x2-x1,y2-y1)
        line=" ".join(a["text"] for a in words).strip()
        if ratio>=0.035:out.append((line,ratio))
    return out

def parse_sender(line):
    m=re.match(r"^\s*(.{1,40}?)\s*[:：]\s*(.*?)\s*$",line)
    if not m:return None
    sender,command=m.group(1).strip(),m.group(2).strip()
    if sender and COMMAND_RE.fullmatch(command):return sender,command
    return None

class RegionPicker(tk.Toplevel):
    def __init__(self,master,callback):
        super().__init__(master);self.callback=callback;self.attributes("-fullscreen",True);self.attributes("-alpha",0.28);self.configure(bg="black")
        self.canvas=tk.Canvas(self,cursor="cross",bg="black",highlightthickness=0);self.canvas.pack(fill="both",expand=True)
        self.start=None;self.rect=None
        self.canvas.create_text(30,30,anchor="nw",fill="white",text="채팅창 영역을 드래그해 선택하세요. 취소: ESC",font=("Malgun Gothic",18))
        self.canvas.bind("<ButtonPress-1>",self.down);self.canvas.bind("<B1-Motion>",self.move);self.canvas.bind("<ButtonRelease-1>",self.up)
        self.bind("<Escape>",lambda e:self.destroy());self.lift();self.focus_force()
    def down(self,e):
        self.start=(e.x_root,e.y_root)
        if self.rect:self.canvas.delete(self.rect)
        self.rect=self.canvas.create_rectangle(e.x,e.y,e.x,e.y,outline="#55ff88",width=3)
    def move(self,e):
        if self.start and self.rect:
            self.canvas.coords(self.rect,self.start[0]-self.winfo_rootx(),self.start[1]-self.winfo_rooty(),e.x,e.y)
    def up(self,e):
        if not self.start:return
        x1,y1=self.start;x2,y2=e.x_root,e.y_root
        r={"left":min(x1,x2),"top":min(y1,y2),"width":abs(x2-x1),"height":abs(y2-y1)}
        self.destroy()
        if r["width"]>80 and r["height"]>40:self.callback(r)

class App:
    def __init__(self,root):
        self.root=root;root.title("LINEAGE W 혈맹 채팅 인식기");root.geometry("760x680");root.minsize(620,560)
        self.cfg=load_config();self.running=False;self.seen={};self.build();self.load_values()
    def build(self):
        m=ttk.Frame(self.root,padding=12);m.pack(fill="both",expand=True)
        ttk.Label(m,text="LINEAGE W · PC 혈맹 채팅 인식기",font=("Malgun Gothic",16,"bold")).pack(anchor="w")
        ttk.Label(m,text="초록색 채팅 줄만 판독합니다. 자동 전송은 기본 OFF이며, 먼저 미리보기로 확인하세요.",wraplength=700).pack(anchor="w",pady=(4,12))
        f=ttk.LabelFrame(m,text="연결 설정",padding=10);f.pack(fill="x")
        self.token=tk.StringVar();self.server=tk.StringVar(value="1");self.tess=tk.StringVar();self.auto=tk.BooleanVar(value=False)
        ttk.Label(f,text="기기 인증키").grid(row=0,column=0,sticky="w");ttk.Entry(f,textvariable=self.token,show="•",width=64).grid(row=0,column=1,sticky="ew",padx=8)
        ttk.Label(f,text="서버").grid(row=1,column=0,sticky="w",pady=(8,0));ttk.Combobox(f,textvariable=self.server,values=["1","2","3"],state="readonly",width=6).grid(row=1,column=1,sticky="w",padx=8,pady=(8,0))
        ttk.Label(f,text="Tesseract 경로").grid(row=2,column=0,sticky="w",pady=(8,0));ttk.Entry(f,textvariable=self.tess).grid(row=2,column=1,sticky="ew",padx=8,pady=(8,0));ttk.Button(f,text="찾기",command=self.browse).grid(row=2,column=2,padx=4,pady=(8,0));f.columnconfigure(1,weight=1)
        c=ttk.Frame(m);c.pack(fill="x",pady=10)
        ttk.Button(c,text="① 채팅창 영역 선택",command=self.pick).pack(side="left");ttk.Button(c,text="② OCR 미리보기",command=self.preview).pack(side="left",padx=6)
        self.startbtn=ttk.Button(c,text="인식 시작",command=self.toggle);self.startbtn.pack(side="left")
        ttk.Checkbutton(c,text="자동 전송 허용 (검증 후에만 켜기)",variable=self.auto,command=self.save_ui).pack(side="right")
        self.regionlabel=ttk.Label(m,text="선택 영역: 아직 선택하지 않았습니다.");self.regionlabel.pack(anchor="w")
        self.status=ttk.Label(m,text="상태: 대기 중");self.status.pack(anchor="w",pady=(4,6))
        p=ttk.LabelFrame(m,text="인식 결과 미리보기",padding=8);p.pack(fill="both",expand=True)
        self.out=tk.Text(p,height=18,wrap="word",font=("Malgun Gothic",10));self.out.pack(fill="both",expand=True)
        self.out.insert("end","게임 화면에서 채팅창 영역을 선택하세요.\n");self.out.configure(state="disabled")
        ttk.Label(m,text="작성자 닉네임과 명령어가 '닉네임: 컷 보스 20:35' 형식으로 함께 잡힐 때만 전송합니다.",wraplength=700).pack(anchor="w",pady=(8,0))
    def load_values(self):
        self.token.set(self.cfg.get("device_token",""));self.server.set(str(self.cfg.get("server_id",1)));self.tess.set(self.cfg.get("tesseract_path",""));self.auto.set(bool(self.cfg.get("auto_send",False)))
        if self.cfg.get("region"):self.regionlabel.configure(text=f"선택 영역: {self.cfg['region']}")
        self.save_ui()
    def save_ui(self):
        self.cfg.update(device_token=self.token.get().strip(),server_id=int(self.server.get() or 1),tesseract_path=self.tess.get().strip(),auto_send=bool(self.auto.get()))
        save_config(self.cfg)
    def browse(self):
        p=filedialog.askopenfilename(title="tesseract.exe 선택",filetypes=[("Tesseract","tesseract.exe"),("실행 파일","*.exe")])
        if p:self.tess.set(p);self.save_ui()
    def pick(self):
        self.root.withdraw();self.root.after(350,lambda:RegionPicker(self.root,self.region_selected))
    def region_selected(self,r):
        self.cfg["region"]=r;self.regionlabel.configure(text=f"선택 영역: {r}");self.root.deiconify();self.save_ui()
    def capture(self):
        r=self.cfg.get("region")
        if not r:raise RuntimeError("먼저 채팅창 영역을 선택하세요.")
        with mss.mss() as s:shot=np.array(s.grab(r))
        return cv2.cvtColor(shot,cv2.COLOR_BGRA2BGR)
    def ocr(self):
        p=self.tess.get().strip()
        if not Path(p).is_file():raise RuntimeError("Tesseract 경로가 올바르지 않습니다. tesseract.exe를 지정하세요.")
        pytesseract.pytesseract.tesseract_cmd=p
        return extract_green_text(self.capture())
    def preview(self):
        try:self.save_ui();self.show(self.ocr(),"미리보기 완료")
        except Exception as e:messagebox.showerror("OCR 미리보기 오류",str(e))
    def show(self,lines,status):
        self.out.configure(state="normal");self.out.delete("1.0","end")
        if not lines:self.out.insert("end","초록색 글씨를 찾지 못했습니다. 선택 영역과 글자 색상을 확인하세요.\n")
        for line,ratio in lines:
            parsed=parse_sender(line);tag=f"작성자/명령 확인: {parsed[0]} / {parsed[1]}" if parsed else "미확인 형식 — 전송하지 않음"
            self.out.insert("end",f"초록색({ratio:.0%}): {line}\n  → {tag}\n\n")
        self.out.configure(state="disabled");self.status.configure(text=f"상태: {status} · 초록색 줄 {len(lines)}개")
    def toggle(self):
        if self.running:self.running=False;self.startbtn.configure(text="인식 시작");self.status.configure(text="상태: 중지됨");return
        try:
            self.save_ui()
            if not self.cfg.get("region"):raise RuntimeError("먼저 채팅창 영역을 선택하세요.")
            if not self.tess.get().strip():raise RuntimeError("Tesseract 경로를 지정하세요.")
            if self.auto.get() and len(self.token.get().strip())<32:raise RuntimeError("자동 전송을 켜려면 보탐봇 기기 인증키가 필요합니다.")
            self.running=True;self.startbtn.configure(text="인식 중지");threading.Thread(target=self.loop,daemon=True).start()
        except Exception as e:messagebox.showerror("시작할 수 없습니다",str(e))
    def loop(self):
        while self.running:
            try:
                lines=self.ocr();self.root.after(0,lambda a=lines:self.show(a,"실시간 인식 중"))
                if self.auto.get():
                    for line,_ in lines:
                        parsed=parse_sender(line)
                        if parsed:self.send(parsed[0],parsed[1])
            except Exception as e:self.root.after(0,lambda x=str(e):self.status.configure(text="오류: "+x))
            time.sleep(max(.6,float(self.cfg.get("poll_seconds",1.2))))
    def send(self,sender,command):
        bucket=datetime.now().strftime("%Y%m%d%H%M")
        fid=hashlib.sha256(f"{self.cfg['server_id']}|{sender}|{command}|{bucket}".encode()).hexdigest()
        if fid in self.seen:return
        self.seen[fid]=time.time();self.seen={k:v for k,v in self.seen.items() if time.time()-v<600}
        body={"action":"ingest","game_nickname":sender,"message":command,"source_message_id":fid,"message_at":datetime.now(timezone.utc).isoformat()}
        try:
            r=requests.post(BRIDGE_URL,json=body,headers={"x-device-token":self.token.get().strip()},timeout=12);data=r.json()
            self.root.after(0,lambda:self.status.configure(text=f"전송 결과: HTTP {r.status_code} · {data.get('status',data.get('error','응답 확인'))}"))
        except Exception as e:self.root.after(0,lambda x=str(e):self.status.configure(text="전송 오류: "+x))

if __name__=="__main__":
    root=tk.Tk()
    try:ttk.Style().theme_use("clam")
    except Exception:pass
    App(root);root.mainloop()

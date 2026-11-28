import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://jangdongkyun.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalizeKey(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,"0")).join("");
}
function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2,"0")).join("");
}
function allowedStatus(status: string | null | undefined): boolean {
  return !["banned","withdrawn","blocked","suspended"].includes(String(status ?? "active").toLowerCase());
}
function parseCommand(message: string, bosses: any[]) {
  const source = String(message ?? "").normalize("NFKC").trim().replace(/\s+/gu," ");
  const match = source.match(/^(컷|취소)\s+(.+?)\s+(\d{1,2}):(\d{2})$/u);
  if (!match) return { ok:false as const, reason:"not_command" };
  const [,command,bossText,hourText,minuteText] = match;
  const hour = Number(hourText), minute = Number(minuteText);
  if (!Number.isInteger(hour) || hour<0 || hour>23 || !Number.isInteger(minute) || minute<0 || minute>59)
    return { ok:false as const, reason:"invalid_time" };
  const target = normalizeKey(bossText);
  const found = (bosses ?? []).filter((boss) => boss?.is_active !== false &&
    [boss?.name,...(Array.isArray(boss?.aliases)?boss.aliases:[])].filter((n)=>typeof n==="string"&&n.trim())
      .some((n)=>normalizeKey(n)===target));
  const unique = [...new Map(found.map((b)=>[String(b.id),b])).values()];
  if (!unique.length) return { ok:false as const, reason:"unknown_boss", bossText };
  if (unique.length>1) return { ok:false as const, reason:"ambiguous_boss", bossText, candidates:unique.map((b)=>b.name) };
  return { ok:true as const, action:command==="컷"?"cut":"cancel", bossId:unique[0].id,
    bossName:unique[0].name, hour, minute, time:`${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")}` };
}
function seoulDateParts(date: Date) {
  const p = new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const v=(k:string)=>Number(p.find((x)=>x.type===k)?.value);
  return {year:v("year"),month:v("month"),day:v("day")};
}
function resolveCutTimestamp(hour:number,minute:number,reference:Date):string {
  const d=seoulDateParts(reference);
  const candidates=[-1,0,1].map((offset)=>Date.UTC(d.year,d.month-1,d.day+offset,hour-9,minute,0,0));
  candidates.sort((a,b)=>Math.abs(a-reference.getTime())-Math.abs(b-reference.getTime()));
  return new Date(candidates[0]).toISOString();
}
async function getUser(req:Request) {
  const m=(req.headers.get("Authorization")??"").match(/^Bearer\s+(.+)$/i);
  if(!m) return null;
  const {data,error}=await db.auth.getUser(m[1]);
  return error||!data.user?null:data.user;
}
async function registerDevice(body:Record<string,unknown>,req:Request) {
  const user=await getUser(req);
  if(!user) return json({error:"로그인이 필요합니다."},401);
  const {data:profile,error:pe}=await db.from("profiles").select("id,account_status,last_server_id").eq("id",user.id).maybeSingle();
  if(pe) throw pe;
  if(!profile||!allowedStatus(profile.account_status)) return json({error:"현재 계정은 기기를 등록할 수 없습니다."},403);
  const {data:membership,error:me}=await db.from("member_access").select("status").eq("user_id",user.id).maybeSingle();
  if(me) throw me;
  if(membership?.status!=="approved") return json({error:"승인된 혈맹원 계정만 기기를 등록할 수 있습니다."},403);
  const platform=String(body.platform??"");
  if(!["android","windows"].includes(platform)) return json({error:"지원하지 않는 기기 종류입니다."},400);
  const serverId=Number(body.server_id??profile.last_server_id??1);
  if(![1,2,3].includes(serverId)) return json({error:"서버 선택 값이 올바르지 않습니다."},400);
  const token=randomToken(), tokenHash=await sha256(token);
  const {data:device,error}=await db.from("chat_capture_devices").insert({
    owner_user_id:user.id,platform,device_name:String(body.device_name??platform).trim().slice(0,80),
    server_id:serverId,token_hash:tokenHash,
  }).select("id,platform,device_name,server_id,created_at").single();
  if(error) throw error;
  return json({ok:true,device,device_token:token,message:"기기 인증키가 발급되었습니다. 이 키는 다시 표시되지 않으니 안전하게 저장하세요."});
}
async function ingest(body:Record<string,unknown>,req:Request) {
  const rawToken=req.headers.get("x-device-token")??"";
  if(rawToken.length<32||rawToken.length>256) return json({error:"기기 인증키가 필요합니다."},401);
  const hash=await sha256(rawToken);
  const {data:device,error:de}=await db.from("chat_capture_devices").select("id,owner_user_id,server_id,enabled")
    .eq("token_hash",hash).eq("enabled",true).maybeSingle();
  if(de) throw de;
  if(!device) return json({error:"등록되지 않았거나 비활성화된 기기입니다."},401);
  const message=String(body.message??"").trim().slice(0,300);
  const gameNickname=String(body.game_nickname??"").trim().slice(0,60);
  const sourceId=String(body.source_message_id??"").trim().slice(0,180);
  if(!message||!gameNickname||!sourceId) return json({error:"message, game_nickname, source_message_id 값이 모두 필요합니다."},400);
  await db.from("chat_capture_devices").update({last_seen_at:new Date().toISOString()}).eq("id",device.id);

  const parsed=undefined;
  const {data:bosses,error:be}=await db.from("bosses").select("id,name,aliases,is_active").eq("is_active",true);
  if(be) throw be;
  const command=parseCommand(message,bosses??[]);
  if(!command.ok&&command.reason==="not_command") return json({ok:true,status:"ignored",message:"등록 명령어가 아닌 일반 채팅입니다."});

  const messageAt=typeof body.message_at==="string"?new Date(body.message_at):new Date();
  if(!Number.isFinite(messageAt.getTime())||messageAt.getTime()>Date.now()+300000||messageAt.getTime()<Date.now()-7*86400000)
    return json({error:"채팅 메시지 시각이 올바르지 않습니다. 최근 7일 이내의 시각을 보내 주세요."},400);
  const cutAt=command.ok?resolveCutTimestamp(command.hour,command.minute,messageAt):null;

  const {data:mapping,error:mapError}=await db.from("game_chat_member_mappings").select("user_id")
    .eq("server_id",device.server_id).eq("normalized_game_nickname",normalizeKey(gameNickname)).maybeSingle();
  if(mapError) throw mapError;
  let mappedUserId:string|null=null;
  if(mapping?.user_id) {
    const {data:p,error:pe}=await db.from("profiles").select("id,account_status").eq("id",mapping.user_id).maybeSingle();
    if(pe) throw pe;
    const {data:m,error:me}=await db.from("member_access").select("status").eq("user_id",mapping.user_id).maybeSingle();
    if(me) throw me;
    if(p&&allowedStatus(p.account_status)&&m?.status==="approved") mappedUserId=mapping.user_id;
  }

  const rpcAction=command.ok?command.action:"cut";
  const {data:result,error:re}=await db.rpc("process_game_chat_command",{
    p_device_id:device.id,p_owner_user_id:device.owner_user_id,p_source_message_id:sourceId,
    p_game_nickname:gameNickname,p_mapped_user_id:mappedUserId,p_boss_id:command.ok?command.bossId:null,
    p_action:rpcAction,p_cut_at:cutAt,p_server_id:device.server_id,p_raw_message:message,
  });
  if(re) throw re;

  if(!command.ok) {
    await db.from("game_chat_command_logs").update({
      status:command.reason,
      result_detail:{message:command.reason==="invalid_time"?"시각 형식이 잘못되었습니다.":command.reason==="ambiguous_boss"?"별칭이 여러 보스와 겹쳐 자동 처리하지 않았습니다.":"등록된 보스 이름 또는 별칭이 아닙니다.",
        candidates:"candidates" in command?command.candidates:[]},
    }).eq("device_id",device.id).eq("source_message_id",sourceId);
    return json({ok:true,status:command.reason,result});
  }
  return json({ok:true,status:result?.status??"processed",action:command.action,boss_name:command.bossName,
    cut_time:command.time,mapped_member:Boolean(mappedUserId),result});
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"POST only"},405);
  let body:Record<string,unknown>;
  try { body=await req.json(); } catch { return json({error:"JSON 요청 본문이 필요합니다."},400); }
  try {
    if(body.action==="register_device") return await registerDevice(body,req);
    if(body.action==="ingest") return await ingest(body,req);
    return json({error:"지원하지 않는 action입니다."},400);
  } catch(error) {
    console.error("game-chat-bridge error",error);
    return json({error:"채팅 명령 처리 중 서버 오류가 발생했습니다."},500);
  }
});

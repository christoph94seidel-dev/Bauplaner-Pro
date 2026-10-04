import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { fileURLToPath } from "url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
const PORT=process.env.PORT||3000;
const DB=path.join(__dirname,"invites.json");
const ai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;

app.use(express.json({limit:"50mb"}));
app.use(express.static(__dirname));

function loadDb(){try{return JSON.parse(fs.readFileSync(DB,"utf8"))}catch{return{}}}
function saveDb(db){fs.writeFileSync(DB,JSON.stringify(db,null,2),"utf8")}

app.post("/api/invite",(req,res)=>{
  const snap=req.body;
  if(!snap?.person?.id)return res.status(400).json({error:"Ungültige Mitarbeiterdaten."});
  const token=crypto.randomBytes(24).toString("hex");
  const db=loadDb();db[token]={...snap,createdAt:new Date().toISOString()};saveDb(db);
  res.json({token});
});

app.get("/api/invite/:token",(req,res)=>{
  const db=loadDb(),snap=db[req.params.token];
  if(!snap)return res.status(404).json({error:"Freigabe nicht gefunden."});
  res.json(snap);
});

app.post("/api/invite/:token/time",(req,res)=>{
  const db=loadDb(),snap=db[req.params.token];
  if(!snap)return res.status(404).json({error:"Freigabe nicht gefunden."});
  const {projectId,date,from,to,breakMin,hours,note}=req.body||{};
  const pr=(snap.projects||[]).find(p=>p.id===projectId);
  if(!pr)return res.status(404).json({error:"Baustelle nicht gefunden."});
  const entry={id:"rt"+Date.now()+crypto.randomBytes(3).toString("hex"),personId:snap.person.id,date,from,to,breakMin:+breakMin||0,hours:+hours||0,rate:0,note:note||"",source:"employee",status:"submitted"};
  pr.timeEntries=pr.timeEntries||[];pr.timeEntries.push(entry);saveDb(db);res.json({entry});
});


app.post("/api/ask",async(req,res)=>{
  try{
    if(!ai)return res.status(503).json({error:"OPENAI_API_KEY fehlt auf dem Server."});
    const {question,image,history}=req.body||{};
    const content=[{type:"input_text",text:`Du bist der BauPlaner-Pro Problemlöser für deutsche Erd-, Tief- und GaLaBau-Praxis. Antworte konkret, umsetzbar und auf Deutsch. Erfinde keine Maße, Eigenschaften oder Bilddetails. Trenne Beobachtung, Annahme und Empfehlung. Wenn für eine Mengenberechnung Maße fehlen, frage gezielt danach. Rechne bekannte Mengen transparent mit Formel. Bei Statik, Leitungen, Böschung, Grundwasser, öffentlichem Verkehrsraum oder Grundstücksgrenzen weise auf notwendige Prüfung hin.\n\n${question||""}`}];
    if(image)content.push({type:"input_image",image_url:image});
    const historyText=Array.isArray(history)&&history.length?"\n\nBISHERIGE UNTERHALTUNG:\n"+history.slice(-8).map(h=>(h.role==='assistant'?"ASSISTENT: ":"NUTZER: ")+String(h.content||'')).join("\n"):"";
    content[0].text+=historyText;
    const response=await ai.responses.create({model:process.env.OPENAI_MODEL||"gpt-5-mini",input:[{role:"user",content}]});
    res.json({answer:response.output_text||"Keine Antwort erhalten."});
  }catch(e){res.status(500).json({error:e?.message||"KI-Problemlöser fehlgeschlagen."})}
});

app.post("/api/estimate",async(req,res)=>{
  try{
    if(!ai)return res.status(503).json({error:"OPENAI_API_KEY fehlt auf dem Server."});
    const {project,images,priceLevel}=req.body||{};
    const content=[{type:"input_text",text:`Du bist Kalkulationsassistent für einen deutschen Erdbau-/Tiefbau-/GaLaBau-Betrieb.
Extrahiere aus Beschreibung, Maßen und ggf. Bildern nur sicher bekannte Kalkulationsparameter und erkannte Leistungsarten. Keine Maße aus Bildern erfinden. Fehlende Maße als Rückfrage ausgeben. Die App selbst berechnet anschließend die Mengen deterministisch.
Projekt: ${JSON.stringify(project)}
Preisniveau-Faktor: ${priceLevel||1}
Antworte ausschließlich als JSON:
{"dimensions":{"area":0,"depthCm":0,"frostCm":0,"splittCm":0,"distanceKm":0},"intents":{"excavation":false,"haul":false,"frost":false,"splitt":false,"paving":false,"compact":false,"edging":false,"drain":false,"concrete":false,"pipe":false},"notes":["..."],"questions":["..."]}
Unbekannte Zahlen bleiben 0. Niemals schätzen.`}];
    for(const img of (images||[]).slice(0,4)){if(img)content.push({type:"input_image",image_url:img})}
    const response=await ai.responses.create({model:process.env.OPENAI_MODEL||"gpt-5-mini",input:[{role:"user",content}]});
    let txt=response.output_text||"";
    txt=txt.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
    const data=JSON.parse(txt);
    res.json(data);
  }catch(e){res.status(500).json({error:e?.message||"KI-Kalkulation fehlgeschlagen."})}
});

app.listen(PORT,()=>console.log(`BauPlaner Pro Server läuft auf ${PORT}`));

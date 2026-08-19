import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split(/\r?\n/).filter(x=>x.includes("=")).map(x=>{const i=x.indexOf("=");return[x.slice(0,i),x.slice(i+1).trim().replace(/^['"]|['"]$/g,"")]}));
const db=createClient(env.SUPABASE_URL,env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const output={};
for(const table of ["credit_cards","card_purchases","card_installments","card_invoices"]){const{count,error}=await db.from(table).select("*",{count:"exact",head:true});if(error)throw error;output[table]=count}
console.log(JSON.stringify(output));

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const multer = require('multer');
const config = require('../config/app');
const {safeLink} = require('./contentSafety');
const groups = new Set(['products','banners','combos','blogs']);
const widths = new Set([96,320,480,768,1200,1600]);
const options = {limitInputPixels:40000000, failOn:'error'};
sharp.concurrency(2);
sharp.cache({memory:32,files:0,items:32});
function imageUrl(value, width = 480) {
  const match = typeof value === 'string' && value.match(/^\/uploads\/(products|banners|combos|blogs)\/([a-zA-Z0-9_.-]+\.(?:png|jpe?g|webp))$/i);
  return match && widths.has(width) ? `/media/${width}/${match[1]}/${match[2]}` : safeLink(value);
}
async function decode(buffer, width) {
  const meta = await sharp(buffer, options).metadata();
  if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('Use a still JPG, PNG or WebP image.');
  return sharp(buffer, options).rotate().resize({width, height:width, fit:'inside', withoutEnlargement:true}).webp({quality:82}).toBuffer();
}
let uploadsInProgress = 0;
function uploader(group) {
  if (!groups.has(group)) throw new Error('Invalid image folder');
  const upload = multer({storage:multer.memoryStorage(), limits:{fileSize:Math.min(config.upload.maxSize,15*1024*1024),files:5,fields:80,fieldSize:200000,parts:90}});
  const wrap = middleware => (req,res,next) => {
    if (uploadsInProgress >= 2) return next(new Error('Image uploads are busy. Please try again.'));
    uploadsInProgress++;
    middleware(req,res,error => {
      if (error) { uploadsInProgress--; return next(error); }
      (async () => {
        const files = req.files || (req.file ? [req.file] : []);
        const converted = [];
        // Validate every file before writing any of them. Client filenames/types are untrusted.
        for (const file of files) converted.push(await decode(file.buffer,1600));
        const dir = path.join(config.upload.baseDir,group);
        await fs.mkdir(dir,{recursive:true});
        const written=[];
        try {
          for (let i=0;i<files.length;i++) {
            const filename=crypto.randomUUID()+'.webp', target=path.join(dir,filename);
            await fs.writeFile(target,converted[i],{flag:'wx'});written.push(target);
            Object.assign(files[i],{filename,path:target,destination:dir,mimetype:'image/webp',size:converted[i].length});
            delete files[i].buffer;
          }
        } catch(err) { await Promise.all(written.map(file=>fs.unlink(file).catch(()=>{})));throw err; }
      })().then(()=>{uploadsInProgress--;next();},()=>{uploadsInProgress--;next(new Error('Could not save images. Use still JPG, PNG or WebP files within the upload limit.'));});
    });
  };
  return {single:field=>wrap(upload.single(field)),array:(field,count)=>wrap(upload.array(field,count))};
}
const pending = new Map();
let active = 0;
const queue = [];
async function limited(job) {
  if (active>=2) {
    if(queue.length>=24) throw Object.assign(new Error('Image processing busy'),{status:503});
    await new Promise(resolve=>queue.push(resolve));
  } else active++;
  try { return await job(); }
  finally { const next=queue.shift();if(next) next();else active--; }
}
async function variant(group,filename,width) {
  const root=await fs.realpath(config.upload.baseDir);
  const original=await fs.realpath(path.join(root,group,filename));
  const relative=path.relative(root,original);
  if(relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('Invalid path'),{status:404});
  const stat=await fs.stat(original);
  if(!stat.isFile() || stat.size>20*1024*1024) throw Object.assign(new Error('Image exceeds processing limit'),{status:415});
  const key=crypto.createHash('sha256').update([relative,stat.size,stat.mtimeMs,width,'webp-v1'].join('|')).digest('hex');
  const dir=path.join(root,'.variants'), target=path.join(dir,key+'.webp');
  try { await fs.access(target);return target; } catch {}
  if(pending.has(key)) return pending.get(key);
  const work=limited(async()=>{
    const data=await decode(await fs.readFile(original),width);
    await fs.mkdir(dir,{recursive:true});
    // Unique temp files and atomic rename also tolerate multiple Node workers.
    const temp=target+'.'+crypto.randomUUID()+'.tmp';
    try {await fs.writeFile(temp,data,{flag:'wx'});await fs.rename(temp,target);}
    finally {await fs.unlink(temp).catch(()=>{});}
    return target;
  }).finally(()=>pending.delete(key));
  pending.set(key,work);return work;
}
async function serve(req,res,next) {
  const {group,filename}=req.params,width=Number(req.params.width);
  if(!groups.has(group) || !widths.has(width) || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpe?g|webp)$/i.test(filename)) return res.sendStatus(404);
  try {
    const file=await variant(group,filename,width);
    res.set({'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'});
    res.sendFile(file,err=>{if(err) next(err);});
  } catch(err) {
    if(err.status===503) {res.set('Retry-After','5');return res.sendStatus(503);}
    if(err.code==='ENOENT'||err.status===404) return res.sendStatus(404);
    // Keep valid legacy originals available if conversion is unavailable.
    res.set('Cache-Control','public, max-age=300');
    res.redirect(`/uploads/${group}/${filename}`);
  }
}
module.exports={imageUrl,uploader,decode,serve,variant};

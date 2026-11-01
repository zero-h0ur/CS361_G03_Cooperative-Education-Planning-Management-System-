const fs=require('node:fs/promises');
const path=require('node:path');
const {ValidationError}=require('../api/errors');
class LocalDocumentStore {
  constructor({root}={}) {this.root=path.resolve(root || path.join(process.cwd(),'tmp/application-documents'));this.local=true;}
  async location(key) {
    if(!/^(staging|final)\/[a-f0-9-]{36}$/.test(key))throw new ValidationError('Invalid storage key');
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    if((await fs.lstat(this.root)).isSymbolicLink())throw new ValidationError('Symbolic storage roots are not allowed');
    const base=await fs.realpath(this.root),dir=path.join(base,key.split('/')[0]);
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    if((await fs.lstat(dir)).isSymbolicLink() || await fs.realpath(dir)!==dir)throw new ValidationError('Invalid storage directory');
    return path.join(dir,key.split('/')[1]);
  }
  async uploadTarget({applicationId,ticketId}) {return {url:`/api/v4/applications/${applicationId}/uploads/${ticketId}/content`,method:'PUT',auth_required:true};}
  async downloadTarget({applicationId,documentId}) {return {url:`/api/v4/applications/${applicationId}/documents/${documentId}/content`,method:'GET',auth_required:true};}
  async writeStaging(key,bytes) {
    if(!key.startsWith('staging/'))throw new ValidationError();
    try{await fs.writeFile(await this.location(key),bytes,{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')throw e;if(!(await this.readStaging(key,bytes.length)).equals(bytes))throw new ValidationError('ไม่อนุญาตเขียนทับไฟล์ staging');}
  }
  async writeFinal(key,bytes) {if(!key.startsWith('final/'))throw new ValidationError();await fs.writeFile(await this.location(key),bytes,{flag:'wx',mode:0o600});}
  async read(key,max) {
    const location=await this.location(key);let handle;
    try {
      if((await fs.lstat(location)).isSymbolicLink())throw new ValidationError('Invalid stored file');
      handle=await fs.open(location,'r');const stat=await handle.stat();
      if(!stat.isFile() || stat.size>max)throw new ValidationError('ไฟล์มีขนาดเกินข้อกำหนด');
      const result=Buffer.alloc(stat.size);let offset=0;
      while(offset<result.length){const {bytesRead}=await handle.read(result,offset,result.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}
      if(offset!==stat.size)throw new ValidationError('อ่านไฟล์ไม่ครบ');
      return result;
    }finally{await handle?.close();}
  }
  async readStaging(key,max) {if(!key.startsWith('staging/'))throw new ValidationError();return this.read(key,max);}
  async readFinal(key,max) {if(!key.startsWith('final/'))throw new ValidationError();return this.read(key,max);}
}
module.exports={LocalDocumentStore};

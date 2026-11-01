const {ServiceUnavailableError,ValidationError}=require('../api/errors');
class S3DocumentStore {
  constructor({bucket,region,client,presignPost,presignGet}={}) {
    if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '') || !/^[a-z]{2}-[a-z]+-\d$/.test(region || ''))throw new ServiceUnavailableError('ตั้งค่า private S3 ไม่ครบ');
    const sdk=require('@aws-sdk/client-s3');
    this.commands=sdk;this.client=client || new sdk.S3Client({region});this.bucket=bucket;
    this.presignPost=presignPost || require('@aws-sdk/s3-presigned-post').createPresignedPost;
    this.presignGet=presignGet || require('@aws-sdk/s3-request-presigner').getSignedUrl;
  }
  key(key,prefix) {if(!new RegExp(`^${prefix}/[a-f0-9-]{36}$`).test(key))throw new ValidationError('Invalid object key');return key;}
  async uploadTarget({key,size,contentType,checksum}) {
    this.key(key,'staging');const encoded=Buffer.from(checksum,'hex').toString('base64');
    const target=await this.presignPost(this.client,{Bucket:this.bucket,Key:key,Expires:300,
      Fields:{'Content-Type':contentType,'x-amz-checksum-algorithm':'SHA256','x-amz-checksum-sha256':encoded},
      Conditions:[['content-length-range',size,size],['eq','$Content-Type',contentType],['eq','$x-amz-checksum-sha256',encoded]]});
    return {url:target.url,fields:target.fields,method:'POST',auth_required:false};
  }
  async readStaging(key,max) {
    const result=await this.client.send(new this.commands.GetObjectCommand({Bucket:this.bucket,Key:this.key(key,'staging')}),{abortSignal:AbortSignal.timeout(15000)});
    if(result.ContentLength>max){result.Body?.destroy?.();throw new ValidationError('ไฟล์มีขนาดเกินข้อกำหนด');}
    const chunks=[];let size=0;
    const timeout=setTimeout(()=>result.Body?.destroy?.(new ServiceUnavailableError('อ่านไฟล์เกินเวลาที่กำหนด')),15000);timeout.unref?.();
    try {for await(const chunk of result.Body){size+=chunk.length;if(size>max)throw new ValidationError('ไฟล์มีขนาดเกินข้อกำหนด');chunks.push(Buffer.from(chunk));}}
    finally{clearTimeout(timeout);result.Body?.destroy?.();}
    return Buffer.concat(chunks,size);
  }
  async writeFinal(key,bytes) {
    await this.client.send(new this.commands.PutObjectCommand({Bucket:this.bucket,Key:this.key(key,'final'),Body:bytes,
      IfNoneMatch:'*',ContentType:'application/octet-stream',ServerSideEncryption:'AES256'}),{abortSignal:AbortSignal.timeout(15000)});
  }
  async downloadTarget({key}) {
    const command=new this.commands.GetObjectCommand({Bucket:this.bucket,Key:this.key(key,'final'),
      ResponseContentType:'application/octet-stream',ResponseContentDisposition:'attachment; filename="coed-document"',ResponseCacheControl:'no-store'});
    return {url:await this.presignGet(this.client,command,{expiresIn:60}),method:'GET',auth_required:false,expires_in:60};
  }
}
module.exports={S3DocumentStore};

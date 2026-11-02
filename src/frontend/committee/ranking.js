// Missing grades follow complete records; never turn a missing grade into zero.
export function compareApplicants(mode='core') {
  const keys=mode==='gpax'?['gpax','core']:['core','gpax'];
  return (a,b)=>{
    for(const key of keys){
      const av=typeof a[key]==='number'&&Number.isFinite(a[key])?a[key]:null;
      const bv=typeof b[key]==='number'&&Number.isFinite(b[key])?b[key]:null;
      if(av===null&&bv!==null)return 1;
      if(bv===null&&av!==null)return -1;
      if(av!==bv)return bv-av;
    }
    return String(a.id).localeCompare(String(b.id));
  };
}

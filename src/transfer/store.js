const SESSION_KEY='guide-transfer-session-v2';
const fail=(code,message)=>Object.assign(new Error(message),{code});

/**
 * One local capture: the page model, and its original pictures stored as
 * binary files beside it. Inaccessible after a browser-session change.
 */
export function createTransferStore({session=globalThis.chrome?.storage?.session,indexedDB=globalThis.indexedDB,locks=globalThis.navigator?.locks,databaseName='guide-transfer-v2'}={}){
  let initialized;
  async function initialize(){
    if(!initialized)initialized=(async()=>{
      if(!session||!indexedDB||!locks)throw fail('storage-unavailable','Chrome capture storage is unavailable. Reopen the extension.');
      const sessionId=await locks.request(`${databaseName}-session`,async()=>{
        const existing=(await session.get(SESSION_KEY))[SESSION_KEY];
        if(existing)return existing;
        const id=globalThis.crypto.randomUUID();await session.set({[SESSION_KEY]:id});return id;
      });
      const db=await new Promise((resolve,reject)=>{
        const request=indexedDB.open(databaseName,2);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('capture'))db.createObjectStore('capture');
          if(!db.objectStoreNames.contains('pictures'))db.createObjectStore('pictures');
        };
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(fail('storage-unavailable','Could not open local capture storage.'));
      });
      return {db,sessionId};
    })();
    return initialized;
  }
  // `update` sees this session's record and returns the record to keep (or
  // null) plus any picture changes, applied in the same transaction. A record
  // returned unchanged is not written again; one from an earlier browser
  // session is discarded.
  async function transaction(update){
    const {db,sessionId}=await initialize();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['capture','pictures'],'readwrite'),store=tx.objectStore('capture'),pictures=tx.objectStore('pictures');let output,error;
      tx.oncomplete=()=>resolve(output);
      tx.onabort=tx.onerror=()=>reject(error??fail('storage-failed','Could not save the complete capture. Check available browser storage.'));
      const request=store.get('current');
      request.onsuccess=()=>{
        try{
          const current=request.result,old=current?.sessionId===sessionId?current:null;
          const {record,result,files}=update(old);output=result;
          if(record){if(record!==old)store.put({...record,sessionId},'current');}
          else if(current){store.delete('current');pictures.clear();}
          if(files){pictures.clear();for(const [id,file] of files)pictures.put(file,id);}
        }catch(cause){error=cause;tx.abort();}
      };
    });
  }
  return {
    load:()=>transaction(old=>({record:old,result:old?{model:old.model,attempt:old.attempt??null}:null})),
    /** Saves a new capture: its model (pictures described, not included) and each picture file by its SHA-256 id. */
    save:async(model,files)=>{
      if(!model||!(/^[a-f0-9]{64}$/i).test(model.sourceHash??'')||JSON.stringify(model).length>64*1024*1024||!(files instanceof Map)||
        model.assets.some(asset=>!(files.get(asset.id) instanceof Blob)||files.get(asset.id).size!==asset.size))throw fail('invalid-capture','The captured page is invalid or incomplete.');
      return transaction(()=>({record:{model},result:undefined,files}));
    },
    /** One picture of this session's capture, as a Blob. */
    picture:async id=>{
      const {db,sessionId}=await initialize();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['capture','pictures'],'readonly'),record=tx.objectStore('capture').get('current'),file=tx.objectStore('pictures').get(id);
        tx.oncomplete=()=>resolve(record.result?.sessionId===sessionId&&record.result.model.assets.some(asset=>asset.id===id)&&file.result instanceof Blob?file.result:null);
        tx.onabort=tx.onerror=()=>reject(fail('storage-failed','Could not read the captured picture.'));
      });
    },
    claimAttempt:attempt=>transaction(old=>{
      if(!old||old.model.sourceHash!==attempt.sourceHash)throw fail('capture-changed','The captured guide changed. Reload the panel before importing.');
      if(old.attempt)throw fail('import-already-attempted','This capture already has an import attempt. Review that draft before starting another.');
      return {record:{...old,attempt:{...attempt,status:'started'}},result:undefined};
    }),
    /** Releases a claim the site's tab refused before starting, so nothing was written and the capture can be sent again. */
    releaseAttempt:attemptId=>transaction(old=>{
      if(old?.attempt?.attemptId!==attemptId||old.attempt.status!=='started')return {record:old,result:false};
      const {attempt,...record}=old;return {record,result:true};
    }),
    completeAttempt:result=>transaction(old=>{
      if(!old?.attempt||result?.verified!==true||result?.publication!=='unpublished')throw fail('unverified-draft','An unpublished draft has not been verified.');
      return {record:{...old,attempt:{...old.attempt,status:'complete',result}},result:undefined};
    }),
    clear:()=>transaction(()=>({record:null,result:undefined,files:new Map()}))
  };
}

/* Runtime animation for the posed, painted hero meshes. Rest geometry and UVs are preserved. */
(function (global) {
  "use strict";
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)] || 0;
  const setups=new Map();
  const ids={root:0,chest:1,head:2,leftThigh:3,leftShin:4,rightThigh:5,rightShin:6,leftArm:7,rightArm:8};
  function prepareGeometry(T,geometry,heroId) {
    const p=geometry.attributes.position;
    const feet=[-1,1].map(side=>{
      const xs=[],zs=[];
      for(let i=0;i<p.count;i++)if(p.getY(i)<.16&&p.getX(i)*side>0){xs.push(p.getX(i));zs.push(p.getZ(i));}
      return {x:median(xs),z:median(zs)};
    });
    // The engineer's spring robot reaches the floor beside her; it is not a third leg.
    if(heroId===6){feet[0]={x:-.29,z:.25};feet[1]={x:.03,z:.25};}
    const bodyX=(feet[0].x+feet[1].x)*.5, bodyZ=(feet[0].z+feet[1].z)*.5;
    const hipY=heroId===3?.56:.51, neckY=heroId===3?1.06:1.02;
    const joints=[[bodyX,0,bodyZ],[bodyX,.68,bodyZ],[bodyX,neckY,bodyZ],
      ...feet.flatMap(f=>[[bodyX+(f.x-bodyX)*.7,hipY,bodyZ+(f.z-bodyZ)*.35],[f.x,.25,f.z]]),
      [bodyX-.28,.92,bodyZ],[bodyX+.28,.92,bodyZ]];
    const setup={joints,feet,bodyX,bodyZ,hipY,neckY};
    setups.set(heroId,setup);geometry.userData.heroRigSetup=setup;
    const indices=new Uint16Array(p.count*4),weights=new Float32Array(p.count*4);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),w=new Float32Array(9);
      const upper=smooth(.48,.78,y);w[0]=1-upper;w[1]=upper;
      // One rigid head, joined through the neck; very small secondary motion preserves hair/props.
      const head=upper*smooth(neckY-.09,neckY+.17,y);
      w[1]-=head;w[2]=head;
      for(let side=0;side<2;side++){
        const f=feet[side],thigh=3+side*2,shin=thigh+1;
        const t=clamp(y/hipY,0,1),cx=f.x+(joints[thigh][0]-f.x)*t,cz=f.z+(joints[thigh][2]-f.z)*t;
        const radius=heroId===3?.29:.265;
        const dist=Math.hypot(x-cx,(z-cz)*.8);
        const spatial=1-smooth(radius*.65,radius*1.5,dist), boot=1-smooth(.13,.29,y);
        let leg=(1-smooth(.40,hipY+.11,y))*(boot+(1-boot)*spatial);
        if(heroId===6)leg*=1-smooth(.18,.34,x); // leave the companion robot with the body
        if(heroId===8)leg*=1-smooth(.36,.56,x); // leave the staff tip with the body
        // Keep left/right weights disjoint at the inner thighs.
        leg*=side===0?1-smooth(bodyX-.07,bodyX+.04,x):smooth(bodyX-.04,bodyX+.07,x);
        const available=w[0]+w[1],take=Math.min(available,leg),lower=1-smooth(.18,.35,y);
        if(available>0){w[0]*=1-take/available;w[1]*=1-take/available;}
        w[thigh]+=take*(1-lower);w[shin]+=take*lower;
      }
      // Modest shoulder motion; the authored armed pose is retained instead of forcing a T-pose.
      const armBand=smooth(.59,.77,y)*(1-smooth(.96,1.09,y));
      const armSide=smooth(.21,.42,Math.abs(x-bodyX));
      const armFront=1-smooth(.23,.5,bodyZ-z);
      const arm=Math.min(w[1],armBand*armSide*armFront*.72);
      w[1]-=arm;w[x<bodyX?7:8]+=arm;
      const strongest=Array.from(w,(value,index)=>({value,index})).filter(q=>q.value>0).sort((a,b)=>b.value-a.value).slice(0,4);
      const total=strongest.reduce((a,q)=>a+q.value,0)||1;
      strongest.forEach((q,k)=>{indices[i*4+k]=q.index;weights[i*4+k]=q.value/total;});
    }
    geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    return geometry;
  }
  function createRig(T,mesh,heroId){
    const setup=mesh.geometry.userData.heroRigSetup||setups.get(heroId);
    if(!setup)throw new Error('Hero geometry must be prepared before binding');
    const parents=[-1,0,1,0,3,0,5,1,1],bones=setup.joints.map((point,i)=>{
      const b=new T.Bone();b.name=Object.keys(ids)[i];
      const parent=parents[i],origin=parent<0?[0,0,0]:setup.joints[parent];
      b.position.set(point[0]-origin[0],point[1]-origin[1],point[2]-origin[2]);return b;
    });
    bones.forEach((b,i)=>{if(parents[i]>=0)bones[parents[i]].add(b);});
    mesh.add(bones[0]);mesh.bind(new T.Skeleton(bones));
    return {mesh,bones,skeleton:mesh.skeleton,heroId,setup,runBlend:0,lastAttack:0,attackTime:1,attackRanged:false,state:'idle'};
  }
  function updateRig(rig,s,dt){
    if(!(dt>0))return;
    const b=rig.bones,blend=1-Math.exp(-dt*14),run=s.run&&s.grounded&&!s.down&&!s.roll?1:0;
    rig.runBlend+=(run-rig.runBlend)*blend;
    if(s.attack>rig.lastAttack+.01){rig.attackTime=0;rig.attackRanged=!!s.ranged;}
    rig.lastAttack=s.attack||0;rig.attackTime+=dt;
    const time=s.time||0,cycle=s.step||0,r=rig.runBlend,swing=Math.sin(cycle),breath=Math.sin(time*2.4);
    for(const bone of b)bone.rotation.set(0,0,0);
    b[0].position.set(...rig.setup.joints[0]);
    b[1].position.y=rig.setup.joints[1][1]+breath*.006;
    b[1].rotation.set(r*.065,Math.sin(cycle)*r*.07,breath*.014);
    b[2].rotation.set(clamp(s.aimPitch||0,-.18,.3)*.2+Math.sin(time*1.7)*.024,Math.sin(time*.8)*.035,Math.sin(time*1.3)*.022);
    b[3].rotation.x=swing*.83*r;b[5].rotation.x=-swing*.83*r;
    b[4].rotation.x=Math.max(0,-swing)*.74*r;b[6].rotation.x=Math.max(0,swing)*.74*r;
    b[7].rotation.x=-swing*.16*r+breath*.025;b[8].rotation.x=swing*.16*r-breath*.025;
    b[7].rotation.z=-Math.abs(swing)*.045*r;b[8].rotation.z=Math.abs(swing)*.045*r;
    // Standing still the weight shifts from foot to foot; running, the body leans into turns.
    const idle=1-r,turn=clamp(s.turn||0,-6,6);
    b[0].position.x+=Math.sin(time*.55)*.012*idle;b[1].rotation.z-=Math.sin(time*.55)*.02*idle;
    b[1].rotation.z-=turn*.028*(.35+r*.65);b[2].rotation.z+=turn*.012;
    rig.state=run?'run':'idle';
    if(!s.grounded){
      rig.state=s.landed?'jump':'drop';
      const tuck=s.landed?clamp((s.vy||0)/8,-.25,1):.3;
      b[3].rotation.x=-.35-tuck*.48;b[5].rotation.x=.12-tuck*.35;
      b[4].rotation.x=.5+tuck*.4;b[6].rotation.x=.35+tuck*.35;
      b[1].rotation.x=-tuck*.07;
      b[7].rotation.z=-.13;b[8].rotation.z=.13;
    }
    if(s.down){const crawl=s.run?1:.1;rig.state='down';b[3].rotation.x=.25+swing*.32*crawl;b[5].rotation.x=.25-swing*.32*crawl;b[4].rotation.x=.45;b[6].rotation.x=.45;b[7].rotation.x=-.12+swing*.14*crawl;b[8].rotation.x=-.12-swing*.14*crawl;}
    if(s.use>0){rig.state='heal';b[1].rotation.x=.08+breath*.035;b[2].rotation.x=.09;b[7].rotation.x=-.12;b[8].rotation.x=-.1;}
    const attack=rig.attackTime;
    if(!s.down&&s.landed&&!s.roll&&attack<.44){
      rig.state=rig.attackRanged?'fire':'attack';
      if(rig.attackRanged){const kick=Math.exp(-attack*19)*Math.sin(Math.min(1,attack/.055)*Math.PI/2);b[1].rotation.x-=kick*.18;b[7].rotation.x-=kick*.15;b[8].rotation.x-=kick*.15;}
      else{
        const wind=-.32*smooth(0,.08,attack),strike=.86*smooth(.08,.16,attack),recover=1-smooth(.2,.44,attack),slash=(wind+strike)*recover;
        b[1].rotation.y+=slash;b[1].rotation.x+=Math.sin(Math.min(1,attack/.44)*Math.PI)*.18;
        b[0].position.z+=smooth(.07,.15,attack)*recover*.12;b[2].rotation.y-=slash*.25;
        b[7].rotation.x-=slash*.3;b[8].rotation.x-=slash*.55;
      }
    }
    // A hit snaps the chest and head back.
    if(s.flash>0){const f=Math.min(1,s.flash);b[1].rotation.x-=f*.3;b[2].rotation.x-=f*.22;b[2].rotation.z+=Math.sin(time*41)*f*.05;b[7].rotation.z-=f*.12;b[8].rotation.z+=f*.12;}
    // Landing: the knees take the weight.
    const sq=s.squash||0;
    if(sq>0&&s.grounded&&!s.roll&&!s.down){b[3].rotation.x-=sq*.55;b[5].rotation.x-=sq*.55;b[4].rotation.x+=sq*.95;b[6].rotation.x+=sq*.95;b[0].position.y-=sq*.09;b[1].rotation.x+=sq*.22;b[7].rotation.z-=sq*.15;b[8].rotation.z+=sq*.15;}
    const em=s.emote;
    if(em&&em.k&&!s.down&&s.landed&&!s.roll&&!s.use)poseEmote(rig,b,em,r,attack,time);
    if(s.roll){rig.state='roll';b[3].rotation.x=b[5].rotation.x=-.48;b[4].rotation.x=b[6].rotation.x=.8;b[1].rotation.x=.08;}
  }
  // Emotes and victory dances. They fade in, fade out at the end and give way to running or attacking.
  function poseEmote(rig,b,em,r,attack,time){
    const t=em.t,len=em.len||2.5,w=clamp(t/.15,0,1)*(1-smooth(len-.3,len,t))*(1-r)*(attack<.44?0:1);
    if(!(w>0))return;
    rig.state='emote';
    const B=(i,x,y,z)=>{b[i].rotation.x+=x*w;b[i].rotation.y+=y*w;b[i].rotation.z+=z*w;},P=(y)=>{b[0].position.y+=y*w;};
    const legs=(q,lift=.65,knee=1)=>{B(3,-Math.max(0,q)*lift,0,0);B(4,Math.max(0,q)*knee,0,0);B(5,-Math.max(0,-q)*lift,0,0);B(6,Math.max(0,-q)*knee,0,0);};
    switch(em.k){
      case'wave':{const q=Math.sin(t*9);B(8,-.55,0,.55+q*.25);B(1,0,-.12,-.06);B(2,.04,-.1,-.08+q*.05);break;}
      case'laugh':{const q=Math.abs(Math.sin(t*11));B(1,-.18-q*.12,0,0);B(2,-.3-q*.1,0,Math.sin(t*5)*.08);P(q*.03);B(7,0,0,-.15);B(8,0,0,.15);break;}
      case'thumbs':{const q=Math.sin(Math.min(1,t*3)*Math.PI/2);B(8,-.6*q,0,.1);B(1,.12,-.15,0);B(2,.1+Math.abs(Math.sin(t*6))*.08,-.15,0);break;}
      case'angry':{const q=Math.sin(t*14);legs(q,.5,.6);B(1,.15,0,q*.06);B(2,.2,0,q*.08);B(7,.15,0,-.25);B(8,.15,0,.25);break;}
      case'cry':{const q=Math.sin(t*16);B(1,.3,0,q*.03);B(2,.45,0,q*.04);B(7,-.35,0,-.1);B(8,-.35,0,.1);P(-.03);break;}
      case'bow':{const q=smooth(0,.4,t)*(1-smooth(1.6,2.1,t));B(1,.65*q,0,0);B(2,.35*q,0,0);B(7,0,0,-.1*q);B(8,0,0,.1*q);break;}
      case'heart':{const q=Math.sin(t*4);B(7,-.45,0,-.35);B(8,-.45,0,.35);B(1,-.06,0,q*.08);B(2,-.1,0,q*.12);P(Math.abs(Math.sin(t*4))*.04);break;}
      case'dance':{const q=Math.sin(t*7);P(Math.abs(q)*.08);b[0].position.x+=q*.08*w;B(1,.05,q*.35,-q*.12);B(2,0,-q*.25,q*.1);legs(q);B(7,-.3,0,-.3-q*.2);B(8,-.3,0,.3-q*.2);break;}
      case'cheer':{const q=Math.abs(Math.sin(t*6.5));P(q*.22);B(7,-.2,0,-.6);B(8,-.2,0,.6);B(3,-q*.3,0,0);B(5,-q*.3,0,0);B(4,q*.5,0,0);B(6,q*.5,0,0);B(2,-.15,0,0);break;}
      case'spin':{b[0].rotation.y+=t*9*w;P(Math.abs(Math.sin(t*9))*.1);B(7,0,0,-.5);B(8,0,0,.5);B(2,-.1,0,0);break;}
      case'robot':{const k=Math.floor(t*4)%4,a=[[.3,-.3],[-.3,.3],[.3,.3],[-.3,-.3]][k];B(7,a[0],0,-.3);B(8,a[1],0,.3);B(2,0,a[0]*.8,0);B(1,0,a[1]*.4,0);legs(k%2?.4:-.4,.25,.3);break;}
      case'flex':{const q=Math.sin(t*5);B(7,-.5,0,-.7);B(8,-.5,0,.7);B(1,-.1,q*.15,0);B(2,-.12,q*.1,0);P(Math.abs(q)*.03);break;}
      case'clap':{const q=Math.abs(Math.sin(t*12));B(7,-.55,0,-.1-q*.35);B(8,-.55,0,.1+q*.35);B(1,-.05,0,0);B(2,-.12+q*.05,0,0);P(q*.02);break;}
      case'kiss':{const q=smooth(0,.6,t),o=smooth(.7,1.3,t);B(8,-.9*q+.5*o,0,.2+.5*o);B(1,-.04,-.1,0);B(2,.08*q-.12*o,-.1,0);break;}
      case'chicken':{const q=Math.sin(t*10);B(7,.1,0,-.55-q*.3);B(8,.1,0,.55+q*.3);B(2,.1+Math.abs(q)*.1,0,q*.08);legs(Math.sin(t*5),.35,.6);P(Math.abs(Math.sin(t*5))*.06);break;}
      case'hop':{const q=Math.sin(t*8);P(Math.max(0,q)*.25);legs(Math.cos(t*8)*.8,.4,.7);B(1,0,Math.sin(t*4)*.3,0);B(7,-.25,0,-.4);B(8,-.25,0,.4);break;}
      default:break;
    }
  }
  global.HeroAnimation={prepareGeometry,createRig,updateRig,poseEmote};
})(typeof window!=='undefined'?window:globalThis);

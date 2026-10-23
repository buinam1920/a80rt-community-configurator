import {KEYS} from '../layout.js';

// These are source-requested spans for the three identified A80RT models.
// In particular, the macro read span is not a physical capacity measurement.
const BLOCKS = [
  ['device',16,32],['settings',17,32,33],['keymap',18,512,34],
  ['lighting',19,16,35],['colors',20,512,36],['macro',21,1024,37],
  ['fn',22,512,38],['rt',23,1024,39],['dks',24,1024,40],
];
const MODELS = [
  [0x80a1,'A80RT U','a80rt-u'],[0x80a2,'A80RT','a80rt'],
  [0xfefc,'A80RT U Dongle','a80rt-u-dongle'],
];
const freeze = object => {
  for (const value of Object.values(object)) if (value && typeof value === 'object') freeze(value);
  return Object.freeze(object);
};

function createCapability(model) {
  const dongle = model[0] === 0xfefc;
  const identity = {vendorId:0x0c45,productId:model[0],productName:model[1],transport:dongle ? 'dongle' : 'wired',model:model[2]};
  const settings = {polling:!dongle,sleep:dongle,wake:false,stability:true,autoCalibration:true,topDeadZone:true,bottomDeadZone:true,responseTime:false,osMode:false,tftTime:false};
  const advanced = ['rs','socd','dks','mt','tgl'];
  const capability = freeze({
    identity,
    // Flat properties remain compatibility aliases for the original consumers.
    model:model[2],name:model[1],vendorId:0x0c45,productId:model[0],
    // Static contracts never grant live writes. Partial color/control evidence
    // and current firmware attestation are evaluated by A80Transport instead.
    source:'protocol-facts.json',hardwareQualified:false,
    transport:dongle ? 'dongle' : 'wired',
    slots:KEYS.map(key=>key.slot),
    blocks:Object.fromEntries(BLOCKS.map(([id,command,length,writeCommand])=>[id,{command,length,...(writeCommand ? {writeCommand} : {})}])),
    settings,advanced,
    // Booleans describe local field editing, not successful device writes.
    fields:{
      device:{version:false,battery:false,axialModel:false},settings,
      rt:{switchId:true,whole:true,bottom:true,rtMode:true,actuationMm:true,pressMm:true,releaseMm:true},
      lighting:{mode:true,red:true,green:true,blue:true,secondaryRed:true,secondaryGreen:true,secondaryBlue:true,colorMode:true,brightness:true,speed:true,direction:true,gearMode:false},
      colors:{rgb:true},keymap:{binding:true},fn:{binding:true},macro:{macros:true},dks:{pattern:true},
    },
    features:{sourceAdvancedBindings:advanced,writeQualified:false},
    maintenance:{manualCalibration:!dongle,reset:true,qualified:false,calibrationEndMaySave:true},
    firmware:{status:'official-handoff-only',officialUrl:'https://leobog.driveall.cn/',directFlash:false,latestVersion:null},
    limits:{
      macroReadSpan:1024,macroPhysicalCapacity:null,macroPointerEntries:100,macroPointerBytes:400,
      macroSourceUiBudget:512,writeAckShape:null,
      switchIds:[0,1,2,3,4,5,6],switchTravelMm:{0:3.4,1:3.4,2:3.3,3:3.3,4:3.4,5:3.4,6:3.4},
      distanceStepMm:0.01,pollingValues:[3,5,6],lightingModes:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,128],
      functionCodes:Array.from({length:22},(_,i)=>i+1),
      fnLockedSlots:Array.from({length:12},(_,i)=>i+1),
      keyboardUsages:[0,...Array.from({length:46},(_,i)=>i+4),...Array.from({length:51},(_,i)=>i+51),107,111,175],
      modifierUsages:[0,224,225,226,227,228,229,230,231],
      mouseCodes:{1:[1,2,4,8,16],3:[1,255]},
      mediaUsages:[404,402,394,387,205,183,182,181,233,234,226,547,551,549,548,554,545],
    },
  });
  return capability;
}

const CAPABILITIES = Object.freeze(MODELS.map(createCapability));

export function identifyDevice(descriptor) {
  const name = typeof descriptor?.productName === 'string' ? descriptor.productName.trim().replace(/\s+/g,' ').toLowerCase() : '';
  const capability = CAPABILITIES.find(capability => descriptor?.vendorId === capability.vendorId && descriptor.productId === capability.productId && name === capability.name.toLowerCase());
  if (!capability) throw new Error('Unsupported A80RT identity: vendorId, productId and productName must match.');
  return capability;
}

export function readPlan(capability) {
  if (!CAPABILITIES.includes(capability)) throw new Error('Capability must come from identifyDevice.');
  return Object.entries(capability.blocks).map(([id,{command,length}])=>({id,command,length}));
}

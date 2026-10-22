// Physical key positions and USB usages observed in the A80RT configurator.
// Each record: label, configuration slot, default USB usage, width in key units.
const rows = [
  [['Esc',0,41],['F1',1,58],['F2',2,59],['F3',3,60],['F4',4,61],['F5',5,62],['F6',6,63],['F7',7,64],['F8',8,65],['F9',9,66],['F10',10,67],['F11',11,68],['F12',12,69],['Ins',103,73],['Prt',99,70]],
  [['`',16,53],['1',17,30],['2',18,31],['3',19,32],['4',20,33],['5',21,34],['6',22,35],['7',23,36],['8',24,37],['9',25,38],['0',26,39],['−',27,45],['=',28,46],['Backspace',92,42,2],['Del',106,76]],
  [['Tab',32,43,1.5],['Q',33,20],['W',34,26],['E',35,8],['R',36,21],['T',37,23],['Y',38,28],['U',39,24],['I',40,12],['O',41,18],['P',42,19],['[',43,47],[']',44,48],['\\',60,49,1.5],['PgUp',105,75]],
  [['Caps',48,57,1.75],['A',49,4],['S',50,22],['D',51,7],['F',52,9],['G',53,10],['H',54,11],['J',55,13],['K',56,14],['L',57,15],[';',58,51],["'",59,52],['Enter',76,40,2.25],['PgDn',108,78]],
  [['Shift',64,225,2.25],['Z',65,29],['X',66,27],['C',67,6],['V',68,25],['B',69,5],['N',70,17],['M',71,16],[',',72,54],['.',73,55],['/',74,56],['Shift',75,229,1.75],['↑',90,82],['End',107,77]],
  [['Ctrl',80,224,1.25],['Win',81,227,1.25],['Alt',82,226,1.25],['Space',83,44,6.25],['Fn',85,0,1.25],['Ctrl',87,228,1.75],['←',88,80],['↓',89,81],['→',91,79]],
];
export const LAYOUT = rows.map((row, rowIndex) => row.map(([label,slot,usage,width=1]) => ({label,slot,usage,width,row:rowIndex})));
export const KEYS = LAYOUT.flat();
export function usageName(usage) {
  if (usage >= 4 && usage <= 29) return String.fromCharCode(65 + usage - 4);
  if (usage >= 30 && usage <= 38) return String(usage-29);
  if (usage === 39) return '0';
  if (usage >= 58 && usage <= 69) return `F${usage-57}`;
  const known = KEYS.find(k => k.usage === usage && usage !== 0);
  return known?.label ?? (usage === 0 ? 'Đặc biệt / trống' : `HID 0x${usage.toString(16).padStart(2,'0')}`);
}

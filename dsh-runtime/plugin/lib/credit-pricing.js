export function parseCreditAmount(value){
  const match=/^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  const cents=match?Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')):0;
  if(cents<1000||cents>99999999)throw Error('Enter at least $10 USD, with no more than two decimal places.');
  return cents;
}

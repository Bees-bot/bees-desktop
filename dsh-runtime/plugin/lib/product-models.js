import {readFileSync} from 'node:fs';
import {parseDocument} from 'yaml';
const profile=parseDocument(readFileSync(new URL('../cordis.patch.yml',import.meta.url),'utf8'),{customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>value}]}).toJSON();
export const shippedModelCatalog=profile.flatMap(row=>row.insert??[row]).find(row=>row.id==='bees').config.localModelCatalog;

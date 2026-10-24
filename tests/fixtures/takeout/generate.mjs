import { writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
const root = new URL('./', import.meta.url).pathname;
const urls = [
'https://www.google.com/maps/place/Trail/@40,-90,17z/data=!3d41.12345678!4d-91.12345678',
'https://www.google.com/maps/search/42,+-92',
'https://maps.google.com/?q=43,-93',
'https://maps.google.com/?ll=44,-94',
'https://www.google.com/maps/search/?api=1&query=45,-95',
'https://www.google.com/maps/place/46,-96',
'https://www.google.com/maps/place/Overlook/@47,-97,17z',
'https://www.google.com/maps/search/48%2C%2B-98',
encodeURIComponent('https://www.google.com/maps/place/Encoded/data=!3d49!4d-99'),
'https://www.google.com/maps/place/?q=place_id:ChIJexample',
'https://maps.google.com/?cid=123456789',
'https://www.google.com/maps/place/Business/data=!1s0x123:0x456',
];
const quote = v => '"' + v.replaceAll('"', '""') + '"';
const csv = '\uFEFFTitle,Note,URL,Comment,Tags\r\n' + urls.map((url,i) => [`Place ${i+1}`, i === 0 ? 'First line\nSecond "line"' : '',url,'Comment','hiking'].map(quote).join(',')).join('\r\n') + '\r\n,,,\r\n';
const feature = (coord,properties) => ({type:'Feature',geometry:{type:'Point',coordinates:coord},properties});
const saved = JSON.stringify({type:'FeatureCollection',features:[
feature([-100,40],{Title:'Prairie',Location:{Address:'Prairie Road','Business Name':'Prairie','Geo Coordinates':{Latitude:'40',Longitude:'-100'}},'Google Maps URL':'https://maps.google.com/?cid=222',Published:'2025-01-01T00:00:00Z',Updated:'2026-01-01T00:00:00Z',Comment:'Morning'}),
feature([0,0],{Title:'Legacy','Google Maps URL':'https://maps.google.com/?q=41,-101'}),
feature([0,0],{Location:{Address:'Lake Road','Geo Coordinates':{Latitude:'42',Longitude:'-102'}}}),
feature([0,0],{Title:'Missing','Google Maps URL':'https://maps.google.com/?cid=333'})]});
const labeled = JSON.stringify({type:'FeatureCollection',features:[feature([-103,43],{name:'Home camp',address:'Forest Road'})]});
const entries = {'Takeout/Saved/Field trips.csv':csv,'Takeout/Maps (your places)/Saved Places.json':saved,'Takeout/Maps/My labeled places/Labeled places.json':labeled,'Takeout/Maps/Reviews.json':'not parsed','Takeout/Mail/mail.mbox':'ignored'};
for(const [name,text] of Object.entries(entries)) { if(!/csv$|places.json$|Places.json$/.test(name)) continue; writeFileSync(root+name.split('/').pop(),text); }
writeFileSync(root+'takeout-fixture.zip',zipSync(Object.fromEntries(Object.entries(entries).map(([n,t])=>[n,strToU8(t)]))));

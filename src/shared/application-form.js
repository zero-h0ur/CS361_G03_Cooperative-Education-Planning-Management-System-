// Data-only form contract shared by the browser, preview and backend.
// No credits, repeat rules or verified university facts are inferred here.
const GROUPS=Object.freeze({
  '61':[['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS264']],
  '66':[['CS100'],['CS101'],['CS102'],['CS111'],['CS213','CS216'],['CS251'],['CS261']]
});
const EXTRAS=Object.freeze({'61':['CS384','CS266','CS322','CS348'],'66':['CS180','CS262','CS331','CS240']});
const GRADES=Object.freeze([['4','A'],['3.5','B+'],['3','B'],['2.5','C+'],['2','C'],['1.5','D+'],['1','D'],['0','F']]);
const MAJORS=Object.freeze([
  ['CIS','คอมพิวเตอร์และวิทยาการสารสนเทศ (CIS) · ภาคปกติ ศูนย์รังสิต'],
  ['ACS','คอมพิวเตอร์ประยุกต์ (ACS) · ภาคพิเศษ ศูนย์รังสิต']
]);
const POSITIONS=Object.freeze([
  ['FRONTEND','Web front-end developer'],['BACKEND','Back-end developer'],['IOS','iOS developer'],
  ['ANDROID','Android developer'],['FULLSTACK','Full stack developer'],['SYSTEM','System engineer (Network / Security)'],
  ['SOFTWARE','Software engineer'],['BA','Business analyst'],['UI_UX','UI / UX Designer'],['DATA','Data scientist / Data engineer']
]);
const ACKNOWLEDGEMENTS=Object.freeze(['program','required_courses','additional_courses','preplacement','gpax','conduct','terms']);
const DECLARED_IDENTITY=Object.freeze(['name_prefix','thai_full_name','english_full_name']);
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
module.exports={FORM_VERSION:2,GROUPS,EXTRAS,GRADES,MAJORS,POSITIONS,ACKNOWLEDGEMENTS,DECLARED_IDENTITY,EMAIL};

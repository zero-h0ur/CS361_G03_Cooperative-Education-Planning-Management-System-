const CHECK_LABELS=Object.freeze([
 ['curriculum','หลักสูตรและกลุ่มวิชาตรงกับหลักฐาน'],
 ['program_type','ภาคปกติ/ภาคพิเศษตรงกับหลักฐาน'],
 ['entry_year','ปีที่เข้าศึกษาตรงกับหลักฐาน'],
 ['grades','เกรดสูงสุดตั้งแต่ C และ GPAX ตรงกับ Transcript'],
 ['documents','ตรวจเอกสารทั้ง 4 ประเภทและเป็นของผู้สมัครรายนี้'],
 ['declarations','ตรวจคำรับรองและหลักฐานประกอบครบแล้ว']
]);
const CHECKS=Object.freeze(CHECK_LABELS.map(([key])=>key));
module.exports={CHECKS,CHECK_LABELS};

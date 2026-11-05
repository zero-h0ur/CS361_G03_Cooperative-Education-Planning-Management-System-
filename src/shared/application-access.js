const READ_ONLY_MESSAGE='ขณะนี้เปิดให้อ่านข้อมูลเท่านั้น ยังไม่เปิดสร้าง แก้ไข แนบไฟล์ หรือส่งใบสมัคร';

function applicationAccess(mode) {
  const restricted=Boolean(mode && mode!=='off');
  return {read_only:restricted,can_create:!restricted,can_edit:!restricted,
    can_upload:!restricted,can_submit:!restricted,can_download:!restricted,
    reason:restricted?'MAINTENANCE':null};
}

module.exports={applicationAccess,READ_ONLY_MESSAGE};

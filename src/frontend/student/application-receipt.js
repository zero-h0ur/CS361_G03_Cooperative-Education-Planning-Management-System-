export function hasCommittedDelivery(app) {
  const receipt = app?.delivery_receipt;
  return app?.status === 'SUBMITTED' && receipt?.status === 'QUEUED_FOR_COORDINATOR' &&
    receipt.application_id === app.id && receipt.submission_id === app.submission?.id &&
    receipt.application_version === app.version && receipt.cycle_id === app.cycle_id &&
    Boolean(receipt.department && receipt.program && receipt.submitted_at);
}

export function assertCommittedDelivery(app) {
  if (!hasCommittedDelivery(app)) {
    const error = new Error('ยังยืนยันผลส่งเข้าคิวไม่ได้ กรุณาลองรายการเดิมซ้ำหรือโหลดข้อมูลล่าสุด ข้อมูลที่กรอกยังอยู่');
    error.code = 'RESULT_UNKNOWN'; throw error;
  }
}

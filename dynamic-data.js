// CO-ED Version 2: Dynamic Data Client Logic
// Self-contained for full compatibility with both HTTP(S) and file:// protocols

(function () {
  'use strict';

  // 1. Initial Embedded Datasets (Ensures immediate data display in any environment)
  const initialData = {
    companies: [
      {
        id: 'agoda',
        name: 'Agoda',
        nameEn: 'Agoda Services Co., Ltd.',
        category: 'Enterprise Software & Travel Tech',
        location: 'กรุงเทพฯ',
        address: '999/9 อาคารดิ ออฟฟิศเศส แอท เซ็นทรัลเวิลด์ ชั้น 45 ถ.พระราม 1 ปทุมวัน กรุงเทพฯ 10330',
        position: 'วิศวกรซอฟต์แวร์',
        benefit: 'มีเบี้ยเลี้ยง (800 บาท/วัน)',
        stipendAmount: 17600,
        coopMOU: true,
        rating: 4.8,
        website: 'https://careersatagoda.com',
        image: 'resources/images/agoda.jpg',
        logoClass: 'partner-logo-agoda-image',
        keywords: ['software engineer', 'ux researcher', 'full stack', 'travel tech']
      },
      {
        id: 'g-able',
        name: 'G-Able',
        nameEn: 'G-Able Public Company Limited',
        category: 'Cloud Solutions & Digital Transformation',
        location: 'กรุงเทพฯ',
        address: '127/35 อาคารปัญจธานี ทาวเวอร์ ถ.นนทรี แขวงช่องนนทรี เขตยานนาวา กรุงเทพฯ 10120',
        position: 'วิศวกรซอฟต์แวร์',
        benefit: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        coopMOU: true,
        rating: 4.5,
        website: 'https://www.g-able.com',
        image: 'resources/images/g-able.png',
        keywords: ['software engineer', 'cloud', 'devops', 'enterprise']
      },
      {
        id: 'gosoft',
        name: 'Gosoft',
        nameEn: 'Gosoft (Thailand) Co., Ltd.',
        category: 'Retail Technology & AI Analytics',
        location: 'กรุงเทพฯ',
        address: 'อาคารธาราสาทร ชั้น 16 เลขที่ 119 ถ.สาทรใต้ สาทร กรุงเทพฯ 10120',
        position: 'นักวิเคราะห์ข้อมูล',
        benefit: 'มีเบี้ยเลี้ยง (550 บาท/วัน)',
        stipendAmount: 12100,
        coopMOU: true,
        rating: 4.4,
        website: 'https://www.gosoft.co.th',
        image: 'resources/images/gosoft.png',
        keywords: ['data analyst', 'cp all', 'retail', 'bi', 'analytics']
      },
      {
        id: 'huawei',
        name: 'Huawei',
        nameEn: 'Huawei Technologies (Thailand) Co., Ltd.',
        category: 'Cloud & Telecommunication Infrastructure',
        location: 'กรุงเทพฯ',
        address: 'อาคารจีทาวเวอร์ แกรนด์ พระราม 9 ชั้น 34-39 ถ.พระราม 9 ห้วยขวาง กรุงเทพฯ 10310',
        position: 'วิศวกรซอฟต์แวร์',
        benefit: 'มีเบี้ยเลี้ยง (700 บาท/วัน)',
        stipendAmount: 15400,
        coopMOU: false,
        rating: 4.6,
        website: 'https://www.huawei.com/th',
        image: 'resources/images/huawei.jpg',
        keywords: ['software engineer', 'cloud', '5g', 'modelarts']
      },
      {
        id: 'kbtg',
        name: 'KBTG',
        nameEn: 'Kasikorn Business-Technology Group',
        category: 'FinTech & Banking Technology',
        location: 'กรุงเทพฯ',
        address: '46/6 หมู่ 9 อาคาร KBTG ถ.ป๊อปปูล่า ต.บ้านใหม่ อ.ปากเกร็ด จ.นนทบุรี 11120',
        position: 'วิศวกรระบบคลาวด์',
        benefit: 'มีเบี้ยเลี้ยง (750-800 บาท/วัน)',
        stipendAmount: 16500,
        coopMOU: true,
        rating: 4.9,
        website: 'https://www.kbtg.tech',
        image: 'resources/images/KBTG.jpg',
        keywords: ['cloud engineer', 'fintech', 'kbank', 'ai', 'kbtg labs']
      },
      {
        id: 'krungsri',
        name: 'Krungsri',
        nameEn: 'Bank of Ayudhya Public Company Limited',
        category: 'Banking & Financial Services',
        location: 'กรุงเทพฯ',
        address: '1222 ถ.พระรามที่ 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพฯ 10120',
        position: 'UX/UI Designer',
        benefit: 'มีเบี้ยเลี้ยง (650 บาท/วัน)',
        stipendAmount: 14300,
        coopMOU: true,
        rating: 4.6,
        website: 'https://www.krungsri.com',
        image: 'resources/images/krungsri.jpg',
        keywords: ['ux designer', 'ui designer', 'mobile banking', 'design system']
      },
      {
        id: 'nectec',
        name: 'NECTEC',
        nameEn: 'National Electronics and Computer Technology Center',
        category: 'Research & Government Cyber Agency',
        location: 'กรุงเทพฯ',
        address: '112 อุทยานวิทยาศาสตร์ประเทศไทย คลองหนึ่ง คลองหลวง ปทุมธานี 12120',
        position: 'Cyber Security',
        benefit: 'มีเบี้ยเลี้ยง (500 บาท/วัน)',
        stipendAmount: 11000,
        coopMOU: true,
        rating: 4.7,
        website: 'https://www.nectec.or.th',
        image: 'resources/images/nectec.png',
        keywords: ['cybersecurity', 'research', 'nstda', 'vulnerability']
      },
      {
        id: 'ptt-digital',
        name: 'PTT Digital',
        nameEn: 'PTT Digital Solutions Co., Ltd.',
        category: 'Enterprise IT & Energy Solutions',
        location: 'กรุงเทพฯ',
        address: '555/1 อาคารเอนเนอร์ยี่คอมเพล็กซ์ อาคารเอ ชั้น 4 ถ.วิภาวดีรังสิต จตุจักร กรุงเทพฯ 10900',
        position: 'Business Analyst',
        benefit: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        coopMOU: true,
        rating: 4.6,
        website: 'https://www.pttdigital.com',
        image: 'resources/images/PTT-Digital.png',
        keywords: ['ptt group', 'business analysis', 'enterprise', 'energy']
      },
      {
        id: 'cp-all',
        name: 'CP ALL',
        nameEn: 'CP ALL Public Company Limited',
        category: 'Retail & Big Data Analytics',
        location: 'กรุงเทพฯ',
        address: '313 อาคาร ซี.พี.ทาวเวอร์ ชั้น 24 ถ.สีลม บางรัก กรุงเทพฯ 10500',
        position: 'วิศวกรข้อมูล',
        benefit: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        coopMOU: true,
        rating: 4.5,
        website: 'https://www.cpall.co.th',
        image: 'resources/images/CP-ALL.png',
        keywords: ['data engineer', 'big data', 'retail', 'spark', 'kafka']
      },
      {
        id: 'scb-tech-x',
        name: 'SCB Tech X',
        nameEn: 'SCB TechX Co., Ltd.',
        category: 'FinTech & Cloud Mobile Engineering',
        location: 'กรุงเทพฯ',
        address: '19 อาคาร 3 เอสซีบี ปาร์ค พลาซ่า ถ.รัชดาภิเษก จตุจักร กรุงเทพฯ 10900',
        position: 'Mobile Developer',
        benefit: 'มีเบี้ยเลี้ยง (700 บาท/วัน)',
        stipendAmount: 15400,
        coopMOU: true,
        rating: 4.8,
        website: 'https://scbtechx.io',
        image: 'resources/images/SCB-TechX.png',
        keywords: ['scbx', 'mobile development', 'flutter', 'ios', 'fintech']
      },
      {
        id: 'scg',
        name: 'SCG',
        nameEn: 'The Siam Cement Public Company Limited',
        category: 'Industrial Tech & Smart Solutions',
        location: 'ปากเกร็ด',
        address: '1 ถ.ปูนซิเมนต์ไทย บางซื่อ กรุงเทพฯ 10800',
        position: 'Software Tester',
        benefit: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        coopMOU: true,
        rating: 4.7,
        website: 'https://www.scg.com',
        image: 'resources/images/SCG.png',
        keywords: ['qa', 'quality assurance', 'automation test', 'cypress', 'playwright']
      },
      {
        id: 'wongnai',
        name: 'Wongnai',
        nameEn: 'LINE MAN Wongnai Co., Ltd.',
        category: 'Food Tech & On-demand Platform',
        location: 'กรุงเทพฯ',
        address: 'อาคารที-วัน (T-One Building) ชั้น 26-28 ถ.สุขุมวิท 40 พระโขนง คลองเตย กรุงเทพฯ 10110',
        position: 'UX Researcher',
        benefit: 'มีเบี้ยเลี้ยง (650 บาท/วัน)',
        stipendAmount: 14300,
        coopMOU: true,
        rating: 4.8,
        website: 'https://careers.lmwn.com',
        image: 'resources/images/wongnai.png',
        keywords: ['user experience research', 'line man', 'food tech', 'ux research']
      }
    ],

    positions: [
      {
        id: 'pos-agoda-01',
        companyId: 'agoda',
        companyName: 'Agoda',
        title: 'Software Engineer Trainee (Full-Stack)',
        field: 'Software Engineering',
        description: 'ร่วมพัฒนาและดูแลฟีเจอร์ของระบบ Booking & Pricing Engine ขนาดใหญ่ที่รองรับผู้ใช้งานหลายล้านคนทั่วโลก ด้วย Node.js, React, TypeScript และ Distributed Systems',
        projectScope: 'พัฒนาระบบ Real-time Room Availability & Dynamic Cache เพื่อเพิ่มความเร็วในการค้นหาห้องพัก 20%',
        capacity: 3,
        appliedCount: 2,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (CentralWorld)',
        stipend: 'มีเบี้ยเลี้ยง (800 บาท/วัน หรือ 17,600 บาท/เดือน)',
        stipendAmount: 17600,
        requiredSkills: ['TypeScript', 'React', 'Node.js', 'Data Structures', 'Git'],
        status: 'open'
      },
      {
        id: 'pos-agoda-02',
        companyId: 'agoda',
        companyName: 'Agoda',
        title: 'UX/UI & Product Design Trainee',
        field: 'UX/UI Design',
        description: 'ทำงานร่วมกับทีม Product & Design ในการทำ User Research, Usability Testing และสร้าง Interactive High-fidelity Prototypes',
        projectScope: 'ออกแบบและทดสอบ Flow การจองแบบ One-Click Checkout เพื่อลด Drop-off Rate ของผู้ใช้มือถือ',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (CentralWorld)',
        stipend: 'มีเบี้ยเลี้ยง (750 บาท/วัน)',
        stipendAmount: 16500,
        requiredSkills: ['Figma', 'User Research', 'Design Systems', 'Prototyping'],
        status: 'open'
      },
      {
        id: 'pos-gable-01',
        companyId: 'g-able',
        companyName: 'G-Able',
        title: 'Cloud Solutions & DevOps Trainee',
        field: 'Cloud & DevOps',
        description: 'ร่วมออกแบบและติดตั้งระบบ Cloud Architecture บน AWS และ Azure จัดทำ CI/CD Pipelines และดูแล Kubernetes Cluster',
        projectScope: 'พัฒนา Automated Infrastructure Deployment ด้วย Terraform และ CI/CD Pipeline สำหรับ Microservices บน AWS EKS',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (สาทร)',
        stipend: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        requiredSkills: ['Linux', 'Docker', 'Kubernetes', 'AWS', 'Terraform', 'CI/CD'],
        status: 'open'
      },
      {
        id: 'pos-gosoft-01',
        companyId: 'gosoft',
        companyName: 'Gosoft',
        title: 'Data Analyst & BI Specialist Trainee',
        field: 'Data Science & AI',
        description: 'วิเคราะห์ข้อมูลพฤติกรรมการซื้อสินค้าและ Supply Chain สำหรับร้านค้าเครือ CP ALL สร้าง Dashboard รายงาน และโมเดลทำนายยอดขาย',
        projectScope: 'พัฒนาระบบ Automated Inventory Forecasting Dashboard บน Power BI และ Python สำหรับจัดการสต็อกสาขา',
        capacity: 3,
        appliedCount: 2,
        workMode: 'Onsite',
        location: 'กรุงเทพฯ (แจ้งวัฒนะ)',
        stipend: 'มีเบี้ยเลี้ยง (550 บาท/วัน)',
        stipendAmount: 12100,
        requiredSkills: ['SQL', 'Python', 'Power BI', 'Data Modeling', 'Excel Advanced'],
        status: 'open'
      },
      {
        id: 'pos-huawei-01',
        companyId: 'huawei',
        companyName: 'Huawei',
        title: 'Software Engineer (Cloud & AI Frameworks)',
        field: 'Software Engineering',
        description: 'วิจัยและพัฒนาซอฟต์แวร์ประยุกต์บน Huawei Cloud ต่อยอด AI Model Inference Engine และพัฒนา Cloud Native API Services',
        projectScope: 'สร้าง API Service สำหรับประมวลผล Computer Vision Inference ผ่าน Huawei ModelArts Cloud',
        capacity: 2,
        appliedCount: 2,
        workMode: 'Onsite',
        location: 'กรุงเทพฯ (พระราม 9)',
        stipend: 'มีเบี้ยเลี้ยง (700 บาท/วัน)',
        stipendAmount: 15400,
        requiredSkills: ['Python', 'C++/Go', 'REST APIs', 'Cloud Computing', 'Docker'],
        status: 'open'
      },
      {
        id: 'pos-kbtg-01',
        companyId: 'kbtg',
        companyName: 'KBTG',
        title: 'Cloud & Infrastructure Engineer Trainee',
        field: 'Cloud & DevOps',
        description: 'ร่วมพัฒนาระบบโครงสร้างพื้นฐานคลาวด์ความมั่นคงสูงสำหรับแอปพลิเคชัน Make by KBank และระบบ Core Banking',
        projectScope: 'พัฒนาระบบ Automated Chaos Testing และ Alerting Gateway บน Kubernetes Cluster',
        capacity: 4,
        appliedCount: 3,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (แจ้งวัฒนะ/เมืองทองธานี)',
        stipend: 'มีเบี้ยเลี้ยง (750-800 บาท/วัน หรือ 16,500 บาท/เดือน)',
        stipendAmount: 16500,
        requiredSkills: ['Kubernetes', 'Go/Python', 'Prometheus', 'Grafana', 'Cloud Security'],
        status: 'open'
      },
      {
        id: 'pos-kbtg-02',
        companyId: 'kbtg',
        companyName: 'KBTG',
        title: 'AI & Machine Learning Research Trainee',
        field: 'Data Science & AI',
        description: 'พัฒนาและทดสอบ Large Language Models (LLM) และ Thai NLP สำหรับระบบผู้ช่วยทางการเงินอัตโนมัติ',
        projectScope: 'Fine-tune Thai Financial LLM เพื่อใช้ในการตอบคำถามธุรกรรมและข้อกำหนดกองทุนรวม',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (เมืองทองธานี)',
        stipend: 'มีเบี้ยเลี้ยง (800 บาท/วัน)',
        stipendAmount: 17600,
        requiredSkills: ['Python', 'PyTorch', 'NLP', 'Vector Databases', 'Prompt Engineering'],
        status: 'open'
      },
      {
        id: 'pos-krungsri-01',
        companyId: 'krungsri',
        companyName: 'Krungsri',
        title: 'UX/UI Designer & Design System Trainee',
        field: 'UX/UI Design',
        description: 'ร่วมพัฒนาระบบ UI Design System ของ Mobile Banking Krungsri App และปรับปรุง Accessibility สำหรับผู้ใช้งานทุกกลุ่ม',
        projectScope: 'ปรับปรุง Flow สมัครสินเชื่อดิจิทัลตามมาตรฐาน Web Content Accessibility Guidelines (WCAG 2.1 AA)',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (พระราม 3)',
        stipend: 'มีเบี้ยเลี้ยง (650 บาท/วัน)',
        stipendAmount: 14300,
        requiredSkills: ['Figma', 'Design Systems', 'Accessibility (a11y)', 'Wireframing'],
        status: 'open'
      },
      {
        id: 'pos-nectec-01',
        companyId: 'nectec',
        companyName: 'NECTEC',
        title: 'Cybersecurity Research & Vulnerability Analyst Trainee',
        field: 'Cybersecurity',
        description: 'ร่วมวิจัยและตรวจสอบช่องโหว่ความปลอดภัยในระบบ Web Applications และ IoT Device Firmware ภายใต้ห้องปฏิบัติการความมั่นคงปลอดภัยไซเบอร์แห่งชาติ',
        projectScope: 'พัฒนา Automated Static Code Analysis & CVE Vulnerability Scanner สำหรับ Open-Source Software',
        capacity: 3,
        appliedCount: 2,
        workMode: 'Onsite',
        location: 'ปทุมธานี (อุทยานวิทยาศาสตร์ประเทศไทย)',
        stipend: 'มีเบี้ยเลี้ยง (500 บาท/วัน)',
        stipendAmount: 11000,
        requiredSkills: ['Network Security', 'OWASP Top 10', 'Python', 'Linux', 'Vulnerability Assessment'],
        status: 'open'
      },
      {
        id: 'pos-pttdigital-01',
        companyId: 'ptt-digital',
        companyName: 'PTT Digital',
        title: 'Business Analyst & IT Solution Consultant Trainee',
        field: 'System Analysis & QA',
        description: 'รวบรวมความต้องการทางธุรกิจ (Requirements Gathering) จัดทำ Software Specification และประสานงานระหว่างผู้ใช้งานกับทีมนักพัฒนาระบบ ERP/CRM',
        projectScope: 'วิเคราะห์และออกแบบกระบวนการขออนุมัติจัดซื้อดิจิทัล (Digital Procurement System Workflow)',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (วิภาวดีรังสิต)',
        stipend: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        requiredSkills: ['Business Analysis', 'UML / BPMN', 'Agile / Scrum', 'SQL', 'Communication'],
        status: 'open'
      },
      {
        id: 'pos-cpall-01',
        companyId: 'cp-all',
        companyName: 'CP ALL',
        title: 'Data Engineer Trainee (Retail Big Data)',
        field: 'Data Science & AI',
        description: 'ออกแบบและสร้าง Data Pipelines สำหรับประมวลผลข้อมูลการขายสาขาทั่วประเทศ จัดเก็บลง Data Lakehouse ด้วย Apache Spark และ Airflow',
        projectScope: 'พัฒนาระบบ Real-time Streaming ETL Pipeline จาก Kafka เข้าสู่ Delta Lake',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Onsite',
        location: 'กรุงเทพฯ (สีลม)',
        stipend: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        requiredSkills: ['SQL', 'Python', 'Apache Spark', 'Kafka', 'Data Warehousing'],
        status: 'open'
      },
      {
        id: 'pos-scbtechx-01',
        companyId: 'scb-tech-x',
        companyName: 'SCB Tech X',
        title: 'Mobile Developer Trainee (Flutter / iOS)',
        field: 'Mobile Development',
        description: 'พัฒนาโมบายล์แอปพลิเคชันยุคใหม่ในกลุ่ม SCBX ด้วย Flutter และ Native iOS/Android เน้น Performance และ Security',
        projectScope: 'พัฒนาระบบ Biometric Authentication และ Secure Storage Module สำหรับโมบายล์แอปพลิเคชัน',
        capacity: 3,
        appliedCount: 2,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (SCB Park พหลโยธิน)',
        stipend: 'มีเบี้ยเลี้ยง (700 บาท/วัน)',
        stipendAmount: 15400,
        requiredSkills: ['Flutter / Dart', 'Swift / Kotlin', 'State Management', 'REST API', 'Git'],
        status: 'open'
      },
      {
        id: 'pos-scg-01',
        companyId: 'scg',
        companyName: 'SCG',
        title: 'Software Quality Assurance & Automation Tester Trainee',
        field: 'System Analysis & QA',
        description: 'ออกแบบ Test Scenarios, Test Cases และสร้าง Automated Test Scripts สำหรับระบบ Logistics & E-Commerce ด้วย Cypress และ Playwright',
        projectScope: 'สร้าง Automated End-to-End Regression Test Suite สำหรับระบบสั่งซื้อวัสดุก่อสร้างออนไลน์',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'นนทบุรี (ปากเกร็ด / บางซื่อ)',
        stipend: 'มีเบี้ยเลี้ยง (600 บาท/วัน)',
        stipendAmount: 13200,
        requiredSkills: ['Cypress', 'Playwright', 'JavaScript', 'Test Planning', 'Postman'],
        status: 'open'
      },
      {
        id: 'pos-wongnai-01',
        companyId: 'wongnai',
        companyName: 'Wongnai',
        title: 'UX Researcher Trainee',
        field: 'UX/UI Design',
        description: 'วางแผนและดำเนินการวิจัยผู้ใช้ทั้งผู้บริโภคและร้านอาหาร (Merchant) เพื่อค้นหา Pain Points และส่งมอบ Actionable Insights แก่ทีม LINE MAN Wongnai',
        projectScope: 'ทำ Usability Testing และ In-depth Interview สำหรับฟีเจอร์การจัดการสต็อกร้านอาหารบน POS System',
        capacity: 2,
        appliedCount: 1,
        workMode: 'Hybrid',
        location: 'กรุงเทพฯ (ทองหล่อ/พระราม 9)',
        stipend: 'มีเบี้ยเลี้ยง (650 บาท/วัน)',
        stipendAmount: 14300,
        requiredSkills: ['User Interviews', 'Usability Testing', 'Figma', 'Qualitative Research'],
        status: 'open'
      }
    ],

    students: [
      {
        id: '6709650012',
        prefix: 'นาย',
        name: 'ชานนท์ วงศ์สวัสดิ์',
        nameEn: 'Chanon Wongsawat',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.65,
        creditsCompleted: 98,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.65 (>= 2.00), หน่วยกิตสะสม 98 หน่วยกิต (>= 90) และผ่านวิชาบังคับพื้นฐานครบถ้วน',
        skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker'],
        interests: ['Software Engineering', 'Full-Stack Development'],
        contact: { email: 'chanon.won@dome.tu.ac.th', phone: '081-234-5678' },
        currentPlanId: 'plan-2567-001'
      },
      {
        id: '6709650046',
        prefix: 'นางสาว',
        name: 'ณัฐธิดา เจริญผล',
        nameEn: 'Natthida Charoenphol',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.82,
        creditsCompleted: 102,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.82 (>= 2.00), หน่วยกิตสะสม 102 หน่วยกิต (>= 90) และผ่านวิชาบังคับพื้นฐานครบถ้วน',
        skills: ['Python', 'PyTorch', 'TensorFlow', 'SQL', 'FastAPI'],
        interests: ['Data Science & AI', 'Machine Learning'],
        contact: { email: 'natthida.cha@dome.tu.ac.th', phone: '082-345-6789' },
        currentPlanId: 'plan-2567-002'
      },
      {
        id: '6709650087',
        prefix: 'นาย',
        name: 'ธนกฤต ศิริสัมพันธ์',
        nameEn: 'Thanakrit Sirisamphan',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.10,
        creditsCompleted: 92,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.10 (>= 2.00), หน่วยกิตสะสม 92 หน่วยกิต (>= 90)',
        skills: ['Linux', 'Docker', 'Kubernetes', 'Go', 'AWS'],
        interests: ['Cloud & DevOps'],
        contact: { email: 'thanakrit.sir@dome.tu.ac.th', phone: '083-456-7890' },
        currentPlanId: 'plan-2567-003'
      },
      {
        id: '6709650123',
        prefix: 'นางสาว',
        name: 'แพรวา กุลศิริ',
        nameEn: 'Praewa Kulsiri',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.40,
        creditsCompleted: 94,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.40 (>= 2.00), หน่วยกิตสะสม 94 หน่วยกิต (>= 90)',
        skills: ['Figma', 'User Research', 'Design Systems', 'HTML/CSS/JS'],
        interests: ['UX/UI Design'],
        contact: { email: 'praewa.kul@dome.tu.ac.th', phone: '084-567-8901' },
        currentPlanId: 'plan-2567-004'
      },
      {
        id: '6709650156',
        prefix: 'นาย',
        name: 'กิตติภพ บุญชู',
        nameEn: 'Kittiphop Boonchoo',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 2.88,
        creditsCompleted: 86,
        requiredCoursesPassed: true,
        eligibilityStatus: 'conditional',
        eligibilityReason: 'รอตรวจสอบ/มีเงื่อนไข: หน่วยกิตสะสมปัจจุบัน 86 หน่วยกิต (ยังไม่ครบ 90) โดยกำลังลงทะเบียนเรียนภาคปัจจุบัน 18 หน่วยกิต หากสอบผ่านจะครบตามเกณฑ์',
        skills: ['Flutter', 'Dart', 'Firebase', 'REST API'],
        interests: ['Mobile Development'],
        contact: { email: 'kittiphop.boo@dome.tu.ac.th', phone: '085-678-9012' },
        currentPlanId: 'plan-2567-005'
      },
      {
        id: '6709650199',
        prefix: 'นาย',
        name: 'ปภังกร เตชะวัฒน์',
        nameEn: 'Paphangkorn Techawat',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.25,
        creditsCompleted: 90,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.25 (>= 2.00), หน่วยกิตสะสม 90 หน่วยกิต (>= 90)',
        skills: ['Cybersecurity', 'Wireshark', 'Python', 'Linux'],
        interests: ['Cybersecurity'],
        contact: { email: 'paphangkorn.tec@dome.tu.ac.th', phone: '086-789-0123' },
        currentPlanId: 'plan-2567-006'
      },
      {
        id: '6709650224',
        prefix: 'นางสาว',
        name: 'วรัญญา รัตนศิลป์',
        nameEn: 'Waranya Rattanasin',
        major: 'วิทยาการข้อมูลและการวิเคราะห์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.52,
        creditsCompleted: 96,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.52 (>= 2.00), หน่วยกิตสะสม 96 หน่วยกิต (>= 90)',
        skills: ['Python', 'SQL', 'Spark', 'Airflow', 'Tableau'],
        interests: ['Data Science & AI'],
        contact: { email: 'waranya.rat@dome.tu.ac.th', phone: '087-890-1234' },
        currentPlanId: null
      },
      {
        id: '6709650268',
        prefix: 'นาย',
        name: 'ศุภวิชญ์ เกียรติสกุล',
        nameEn: 'Suphawit Kiatsakul',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 2.15,
        creditsCompleted: 82,
        requiredCoursesPassed: false,
        eligibilityStatus: 'conditional',
        eligibilityReason: 'รอตรวจสอบ/มีเงื่อนไข: ยังไม่ผ่านวิชาบังคับก่อน CS284 และหน่วยกิตสะสม 82 หน่วยกิต',
        skills: ['Java', 'Spring Boot', 'MySQL', 'Git'],
        interests: ['Backend Development'],
        contact: { email: 'suphawit.kia@dome.tu.ac.th', phone: '088-901-2345' },
        currentPlanId: null
      },
      {
        id: '6709650311',
        prefix: 'นาย',
        name: 'ธีรภัทร เมธากิจ',
        nameEn: 'Theeraphat Methakit',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 1.88,
        creditsCompleted: 74,
        requiredCoursesPassed: false,
        eligibilityStatus: 'ineligible',
        eligibilityReason: 'ไม่ผ่านเกณฑ์: เกรดเฉลี่ยสะสม 1.88 ต่ำกว่าเกณฑ์ขั้นต่ำ 2.00 และหน่วยกิตสะสม 74 หน่วยกิต (ต้องไม่น้อยกว่า 90 หน่วยกิต)',
        skills: ['C++', 'Python', 'Basic Web'],
        interests: ['Game Development'],
        contact: { email: 'theeraphat.met@dome.tu.ac.th', phone: '089-012-3456' },
        currentPlanId: null
      },
      {
        id: '6709650058',
        prefix: 'นาย',
        name: 'อภิสิทธิ์ จิตประภัสร์',
        nameEn: 'Aphisit Jitpraphat',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2561',
        year: 4,
        gpax: 3.12,
        creditsCompleted: 118,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน (หลักสูตร 61): ชั้นปี 4, GPAX 3.12 (>= 2.00), หน่วยกิตสะสม 118 หน่วยกิต (>= 90)',
        skills: ['JavaScript', 'React', 'Cypress', 'Playwright'],
        interests: ['Software Quality Assurance'],
        contact: { email: 'aphisit.jit@dome.tu.ac.th', phone: '081-112-2233' },
        currentPlanId: 'plan-2567-007'
      },
      {
        id: '6709650114',
        prefix: 'นางสาว',
        name: 'พิชญา อนันตชัย',
        nameEn: 'Pitchaya Anantachai',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2561',
        year: 4,
        gpax: 3.38,
        creditsCompleted: 122,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน (หลักสูตร 61): ชั้นปี 4, GPAX 3.38 (>= 2.00), หน่วยกิตสะสม 122 หน่วยกิต (>= 90)',
        skills: ['Business Analysis', 'UML', 'BPMN', 'Agile', 'SQL'],
        interests: ['System Analysis & QA'],
        contact: { email: 'pitchaya.ana@dome.tu.ac.th', phone: '082-223-3344' },
        currentPlanId: 'plan-2567-008'
      },
      {
        id: '6709650458',
        prefix: 'นาย',
        name: 'ปพนพัชร์ มีวน',
        nameEn: 'Paphonpat Meewon',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.70,
        creditsCompleted: 98,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.70 (>= 2.00), หน่วยกิตสะสม 98 หน่วยกิต (>= 90)',
        skills: ['Full-Stack', 'Node.js', 'React', 'Cloud Services'],
        interests: ['Software Engineering'],
        contact: { email: 'paphonpat.mee@dome.tu.ac.th', phone: '083-334-4455' },
        currentPlanId: null
      },
      {
        id: '6709650565',
        prefix: 'นาย',
        name: 'ภูริณัฐ วรรธนะธัญญา',
        nameEn: 'Phurinat Wattanathanva',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.55,
        creditsCompleted: 96,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.55 (>= 2.00), หน่วยกิตสะสม 96 หน่วยกิต (>= 90)',
        skills: ['Frontend Engineering', 'UI/UX', 'JavaScript', 'CSS'],
        interests: ['Frontend Architecture'],
        contact: { email: 'phurinat.wat@dome.tu.ac.th', phone: '084-445-5566' },
        currentPlanId: null
      },
      {
        id: '6709650607',
        prefix: 'นาย',
        name: 'รณกฤต วรลักษณ์ภักดี',
        nameEn: 'Ronnakrit Woralakpakdee',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.62,
        creditsCompleted: 94,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.62 (>= 2.00), หน่วยกิตสะสม 94 หน่วยกิต (>= 90)',
        skills: ['Backend Development', 'API Design', 'Microservices'],
        interests: ['Distributed Systems'],
        contact: { email: 'ronnakrit.wor@dome.tu.ac.th', phone: '085-556-6677' },
        currentPlanId: null
      },
      {
        id: '6709650334',
        prefix: 'นาย',
        name: 'ณัษฐภาคย์ ไกรวิชญ์ชนาพร',
        nameEn: 'Natthapak Kraivitchanaporn',
        major: 'วิทยาการคอมพิวเตอร์',
        curriculum: 'หลักสูตรปรับปรุง 2566',
        year: 3,
        gpax: 3.48,
        creditsCompleted: 92,
        requiredCoursesPassed: true,
        eligibilityStatus: 'eligible',
        eligibilityReason: 'ผ่านเกณฑ์ครบถ้วน: ชั้นปี 3, GPAX 3.48 (>= 2.00), หน่วยกิตสะสม 92 หน่วยกิต (>= 90)',
        skills: ['DevOps', 'Cloud Infrastructure', 'CI/CD', 'Docker'],
        interests: ['Cloud & DevOps'],
        contact: { email: 'natthapak.kra@dome.tu.ac.th', phone: '086-667-7788' },
        currentPlanId: null
      }
    ],

    cycles: [
      {
        id: 'cycle-2567-2',
        academicYear: '2567',
        semester: 2,
        title: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        status: 'active',
        statusLabel: 'กำลังเปิดรับสมัครและยื่นแผน',
        targetAudience: 'นักศึกษาชั้นปีที่ 3-4 สาขาวิชาวิทยาการคอมพิวเตอร์ และวิทยาการข้อมูล',
        applicationStart: '2024-09-01',
        applicationDeadline: '2024-11-15',
        approvalAnnouncement: '2024-11-30',
        coopStart: '2025-01-06',
        coopEnd: '2025-05-09',
        totalQuota: 60,
        enrolledCount: 38,
        description: 'รอบการปฏิบัติงานสหกิจศึกษาภาคเรียนที่ 2 ปีการศึกษา 2567 ระยะเวลาปฏิบัติงานเต็มเวลาไม่น้อยกว่า 16 สัปดาห์ (มกราคม - พฤษภาคม 2568)',
        milestones: [
          {
            step: 1,
            title: 'ยื่นความจำนงและเสนอแผนสหกิจศึกษา',
            deadline: '2024-11-15',
            status: 'in_progress',
            statusLabel: 'กำลังดำเนินการ',
            description: 'นักศึกษาตรวจสอบคุณสมบัติ เลือกสถานประกอบการ และส่งร่างหัวข้อ/วัตถุประสงค์แผนสหกิจ'
          },
          {
            step: 2,
            title: 'อาจารย์และคณะกรรมการพิจารณาอนุมัติแผน',
            deadline: '2024-11-25',
            status: 'upcoming',
            statusLabel: 'รอดำเนินการ',
            description: 'คณะกรรมการสหกิจพิจารณาความเหมาะสมของขอบเขตงานและแต่งตั้งอาจารย์ที่ปรึกษาสหกิจ'
          },
          {
            step: 3,
            title: 'ประกาศผลการพิจารณาและปฐมนิเทศนักศึกษา',
            deadline: '2024-11-30',
            status: 'upcoming',
            statusLabel: 'รอดำเนินการ',
            description: 'เข้าร่วมการปฐมนิเทศเพื่อรับฟังแนวปฏิบัติ จริยธรรมในการทำงาน และรับหนังสือส่งตัว'
          },
          {
            step: 4,
            title: 'วันเริ่มปฏิบัติงาน ณ สถานประกอบการ',
            deadline: '2025-01-06',
            status: 'upcoming',
            statusLabel: 'กำหนดการสำคัญ',
            description: 'รายงานตัว ณ สถานประกอบการ และเริ่มปฏิบัติงานจริงตามแผนงานที่ได้รับอนุมัติ'
          },
          {
            step: 5,
            title: 'การนิเทศงานครั้งที่ 1 & ส่งรายงานความก้าวหน้า',
            deadline: '2025-02-21',
            status: 'upcoming',
            statusLabel: 'รอดำเนินการ',
            description: 'อาจารย์นิเทศติดตามความก้าวหน้าร่วมกับพนักงานที่ปรึกษา และนักศึกษาส่งรายงานฉบับแรก'
          },
          {
            step: 6,
            title: 'การนิเทศงานครั้งที่ 2',
            deadline: '2025-04-04',
            status: 'upcoming',
            statusLabel: 'รอดำเนินการ',
            description: 'ประเมินความสมบูรณ์ของโครงงานและรับข้อเสนอแนะสำหรับการจัดทำเล่มรายงาน'
          },
          {
            step: 7,
            title: 'วันสิ้นสุดการปฏิบัติงานและปัจฉิมนิเทศ',
            deadline: '2025-05-09',
            status: 'upcoming',
            statusLabel: 'รอดำเนินการ',
            description: 'ส่งเล่มรายงานโครงงานสหกิจฉบับสมบูรณ์ นำเสนอผลงาน และเข้ารับการประเมินผล'
          }
        ]
      },
      {
        id: 'cycle-2567-1',
        academicYear: '2567',
        semester: 1,
        title: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 1/2567',
        status: 'completed',
        statusLabel: 'เสร็จสิ้นการปฏิบัติงานแล้ว',
        targetAudience: 'นักศึกษาชั้นปีที่ 4',
        applicationStart: '2024-03-01',
        applicationDeadline: '2024-05-15',
        approvalAnnouncement: '2024-05-31',
        coopStart: '2024-08-05',
        coopEnd: '2024-12-06',
        totalQuota: 45,
        enrolledCount: 42,
        description: 'รอบปฏิบัติงานสหกิจศึกษา ภาคเรียนที่ 1 ปีการศึกษา 2567 นักศึกษาทุกคนส่งเล่มรายงานเรียบร้อยแล้ว',
        milestones: [
          { step: 1, title: 'ยื่นความจำนงและเสนอแผนสหกิจศึกษา', deadline: '2024-05-15', status: 'completed', statusLabel: 'เสร็จสิ้น', description: 'ส่งเอกสารและได้รับการอนุมัติ' },
          { step: 2, title: 'วันสิ้นสุดการปฏิบัติงานและส่งรายงาน', deadline: '2024-12-06', status: 'completed', statusLabel: 'เสร็จสิ้น', description: 'ประเมินผลและตัดเกรดเสร็จสิ้น' }
        ]
      },
      {
        id: 'cycle-2568-1',
        academicYear: '2568',
        semester: 1,
        title: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 1/2568 (รอบล่วงหน้า)',
        status: 'upcoming',
        statusLabel: 'เตรียมเปิดรับสมัครรอบล่วงหน้า',
        targetAudience: 'นักศึกษาชั้นปีที่ 3 ที่ขึ้นปี 4',
        applicationStart: '2025-03-01',
        applicationDeadline: '2025-05-15',
        approvalAnnouncement: '2025-05-30',
        coopStart: '2025-08-04',
        coopEnd: '2025-12-05',
        totalQuota: 65,
        enrolledCount: 0,
        description: 'รอบสหกิจศึกษาสำหรับภาคการศึกษาที่ 1 ปีการศึกษา 2568 สถานประกอบการสามารถส่งรายการตำแหน่งงานได้ล่วงหน้า',
        milestones: [
          { step: 1, title: 'เปิดรับข้อเสนอโครงการจากสถานประกอบการ', deadline: '2025-02-15', status: 'upcoming', statusLabel: 'กำหนดการล่วงหน้า', description: 'รวบรวมตำแหน่งงานและโครงการสหกิจจากพันธมิตร' },
          { step: 2, title: 'เปิดรับสมัครนักศึกษายื่นแผน', deadline: '2025-03-01', status: 'upcoming', statusLabel: 'กำหนดการล่วงหน้า', description: 'เริ่มเปิดระบบให้นักศึกษาเลือกสถานประกอบการและส่งแผน' }
        ]
      }
    ],

    plans: [
      {
        id: 'plan-2567-001',
        studentId: '6709650012',
        studentName: 'ชานนท์ วงศ์สวัสดิ์',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.65,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'agoda',
        companyName: 'Agoda',
        positionId: 'pos-agoda-01',
        positionTitle: 'Software Engineer Trainee (Full-Stack)',
        proposedTopic: 'การปรับปรุงประสิทธิภาพระบบ Caching สำหรับ High-concurrency Hotel Search Engine ด้วย Redis Cluster และ In-memory Multi-tier Cache',
        objective: '1. เพื่อศึกษาและออกแบบสถาปัตยกรรม Distributed Cache สำหรับลด Response Latency ในระบบค้นหาโรงแรม\n2. เพื่อสร้างระบบ Invalidation กลางที่รองรับการอัปเดตราคาแบบ Real-time\n3. เพื่อลดภาระ Database Load ลงอย่างน้อย 25%',
        facultyAdvisor: 'รศ.ดร.สมชาย ทรงคุณ',
        companyMentor: 'นายธนาธิป เจริญดี (Senior Tech Lead, Agoda Search Team)',
        status: 'approved',
        statusLabel: 'ผ่านการอนุมัติ',
        submittedAt: '2024-10-05T09:30:00.000Z',
        reviewNotes: 'ขอบเขตงานและหัวข้อโครงงานมีความชัดเจน สอดคล้องกับมาตรฐานสหกิจศึกษาและหลักสูตรวิทยาการคอมพิวเตอร์ อนุมัติให้ออกปฏิบัติงานได้'
      },
      {
        id: 'plan-2567-002',
        studentId: '6709650046',
        studentName: 'ณัฐธิดา เจริญผล',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.82,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'kbtg',
        companyName: 'KBTG',
        positionId: 'pos-kbtg-02',
        positionTitle: 'AI & Machine Learning Research Trainee',
        proposedTopic: 'การพัฒนาและเพิ่มประสิทธิภาพแบบจำลองภาษาขนาดใหญ่ภาษาไทย (Thai LLM) สำหรับสกัดสาระสำคัญจากเอกสารวิเคราะห์การลงทุน',
        objective: '1. เพื่อพัฒนา Pipeline การทำ Data Preprocessing และ Prompt Fine-tuning สำหรับภาษาไทยเฉพาะทางด้านการเงิน\n2. เพื่อสร้างระบบ RAG (Retrieval-Augmented Generation) ร่วมกับ Vector Database ในการสืบค้นข้อมูลเชิงลึก\n3. เพื่อทดสอบความถูกต้องตามมาตรวัด F1-Score และ ROUGE',
        facultyAdvisor: 'ศ.ดร.วิภาดา รัตนกุล',
        companyMentor: 'ดร.กานต์ นพรัตน์ (AI Research Lead, KBTG Labs)',
        status: 'approved',
        statusLabel: 'ผ่านการอนุมัติ',
        submittedAt: '2024-10-06T11:15:00.000Z',
        reviewNotes: 'หัวข้อโครงงานมีความเป็นนวัตกรรมสูง อาจารย์ที่ปรึกษาเห็นชอบกับขอบเขตงานและบริษัทผู้รับรอง'
      },
      {
        id: 'plan-2567-003',
        studentId: '6709650087',
        studentName: 'ธนกฤต ศิริสัมพันธ์',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.10,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'g-able',
        companyName: 'G-Able',
        positionId: 'pos-gable-01',
        positionTitle: 'Cloud Solutions & DevOps Trainee',
        proposedTopic: 'การวางระบบ Infrastructure as Code และ Automated CI/CD Pipeline สำหรับสถาปัตยกรรม Microservices บน AWS EKS',
        objective: '1. เพื่อแปลง Manual Infrastructure ให้เป็น Terraform Modules ที่จัดการเวอร์ชันได้\n2. เพื่อสร้าง GitOps Pipeline โดยใช้ ArgoCD และ GitHub Actions\n3. เพื่อลดเวลาการ Deployment จาก 45 นาที เหลือไม่เกิน 10 นาที',
        facultyAdvisor: 'ผศ.ดร.อรรถพล พรหมสุข',
        companyMentor: 'นายอัครเดช บุณยพงษ์ (Cloud Architect Manager)',
        status: 'approved',
        statusLabel: 'ผ่านการอนุมัติ',
        submittedAt: '2024-10-08T14:40:00.000Z',
        reviewNotes: 'อนุมัติแผนงาน ขอบเขตงานทางด้าน DevOps ชัดเจน ให้ประสานงานกับพี่เลี้ยงเรื่องความปลอดภัยของ Credential บน Cloud'
      },
      {
        id: 'plan-2567-004',
        studentId: '6709650123',
        studentName: 'แพรวา กุลศิริ',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.40,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'wongnai',
        companyName: 'Wongnai',
        positionId: 'pos-wongnai-01',
        positionTitle: 'UX Researcher Trainee',
        proposedTopic: 'การศึกษาพฤติกรรมผู้ใช้และออกแบบเพื่อลดอัตราความผิดพลาดในการจัดการออเดอร์ร้านอาหารบนแพลตฟอร์ม LINE MAN POS',
        objective: '1. เพื่อวิจัยแบบผสม (Mixed-methods) สัมภาษณ์เชิงลึกผู้ประกอบการร้านอาหาร 30 ร้าน\n2. เพื่อค้นหาสาเหตุของ Order Processing Delay และ Order Cancellation\n3. เพื่อสร้าง UI/UX Prototype และทดสอบ Usability กับกลุ่มตัวอย่าง',
        facultyAdvisor: 'อ.ดร.กมลทิพย์ สุวรรณเวช',
        companyMentor: 'นางสาวสุดารัตน์ พงษ์ศิริ (Senior UX Researcher, LINE MAN Wongnai)',
        status: 'pending',
        statusLabel: 'รอการพิจารณา',
        submittedAt: '2024-10-15T16:00:00.000Z',
        reviewNotes: 'คณะกรรมการกำลังตรวจสอบขอบเขตงานโครงงานร่วมกับอาจารย์ประจำสาขา'
      },
      {
        id: 'plan-2567-005',
        studentId: '6709650156',
        studentName: 'กิตติภพ บุญชู',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 2.88,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'scb-tech-x',
        companyName: 'SCB Tech X',
        positionId: 'pos-scbtechx-01',
        positionTitle: 'Mobile Developer Trainee (Flutter / iOS)',
        proposedTopic: 'การพัฒนาระบบ Biometric Authentication และ Secure Storage สำหรับ Cross-platform Mobile Application ด้วย Flutter',
        objective: '1. เพื่อพัฒนาระบบสแกนลายนิ้วมือ/ใบหน้า ร่วมกับ Secure KeyStore\n2. เพื่อเข้ารหัสข้อมูลที่จัดเก็บในเครื่องตามมาตรฐาน AES-256\n3. เพื่อรองรับการทำงานทั้ง iOS และ Android อย่างมีเสถียรภาพ',
        facultyAdvisor: 'ผศ.ดร.อรรถพล พรหมสุข',
        companyMentor: 'นายณัฐพงษ์ สินธุวงศ์ (Principal Mobile Engineer)',
        status: 'needs_revision',
        statusLabel: 'ส่งกลับแก้ไข',
        submittedAt: '2024-10-10T10:00:00.000Z',
        reviewNotes: 'ข้อสังเกต: นักศึกษามีสถานะรอตรวจสอบหน่วยกิตสะสม (86 หน่วยกิต) โปรดแนบใบแสดงผลการเรียนคาดว่าจะจบภาคการศึกษา'
      },
      {
        id: 'plan-2567-006',
        studentId: '6709650199',
        studentName: 'ปภังกร เตชะวัฒน์',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.25,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'nectec',
        companyName: 'NECTEC',
        positionId: 'pos-nectec-01',
        positionTitle: 'Cybersecurity Research & Vulnerability Analyst Trainee',
        proposedTopic: 'การพัฒนาระบบวิเคราะห์ช่องโหว่ความปลอดภัยแบบอัตโนมัติในซอร์สโค้ดโอเพนซอร์สตามมาตรฐาน OWASP Top 10 และ CVE Matrix',
        objective: '1. เพื่อสร้างเครื่องมือ Static Application Security Testing (SAST) วิเคราะห์ AST\n2. เพื่อตรวจสอบและแจ้งเตือนช่องโหว่ประเภท SQL Injection และ RCE\n3. เพื่อทดสอบความแม่นยำเทียบกับเครื่องมือมาตรฐานสากล',
        facultyAdvisor: 'รศ.ดร.สมชาย ทรงคุณ',
        companyMentor: 'ดร.อนุชา รัตนโรจน์ (นักวิจัยอาวุโส NECTEC)',
        status: 'approved',
        statusLabel: 'ผ่านการอนุมัติ',
        submittedAt: '2024-10-11T13:20:00.000Z',
        reviewNotes: 'อนุมัติแผนงาน หัวข้อมีความเป็นวิชาการและเป็นประโยชน์ต่อสังคมสูง'
      },
      {
        id: 'plan-2567-007',
        studentId: '6709650058',
        studentName: 'อภิสิทธิ์ จิตประภัสร์',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.12,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'scg',
        companyName: 'SCG',
        positionId: 'pos-scg-01',
        positionTitle: 'Software Quality Assurance & Automation Tester Trainee',
        proposedTopic: 'การสร้าง Automated End-to-End Regression Testing Framework บน Cloud CI/CD สำหรับระบบ B2B E-Commerce ด้วย Playwright',
        objective: '1. เพื่อพัฒนา Automated Test Suite ครอบคลุม Core User Journeys\n2. เพื่อเชื่อมต่อการรันชุดทดสอบเข้ากับ GitLab CI Pipeline\n3. เพื่อลดเวลา Regression Test จาก 2 วันทำการ เหลือ 30 นาที',
        facultyAdvisor: 'อ.ดร.กมลทิพย์ สุวรรณเวช',
        companyMentor: 'นางพิมพา สกุลวงศ์ (QA Lead, SCG Digital)',
        status: 'pending',
        statusLabel: 'รอการพิจารณา',
        submittedAt: '2024-10-18T08:50:00.000Z',
        reviewNotes: 'อยู่ระหว่างให้อาจารย์ที่ปรึกษาพิจารณาและตรวจสอบคู่ขนานกับบริษัท'
      },
      {
        id: 'plan-2567-008',
        studentId: '6509650114',
        studentName: 'พิชญา อนันตชัย',
        studentMajor: 'วิทยาการคอมพิวเตอร์',
        studentGpax: 3.38,
        cycleId: 'cycle-2567-2',
        cycleTitle: 'รอบสหกิจศึกษา ภาคการศึกษาที่ 2/2567',
        companyId: 'ptt-digital',
        companyName: 'PTT Digital',
        positionId: 'pos-pttdigital-01',
        positionTitle: 'Business Analyst & IT Solution Consultant Trainee',
        proposedTopic: 'การวิเคราะห์และออกแบบระบบขออนุมัติจัดซื้อจัดจ้างดิจิทัล (Digital Procurement Workflow) แบบไร้กระดาษด้วยสถาปัตยกรรม Microservices',
        objective: '1. เพื่อศึกษา Business Process ปัจจุบัน และจัดทำ As-Is / To-Be Workflow\n2. เพื่อระบุ Functional & Non-functional Requirements\n3. เพื่อจัดทำ Wireframes และ UAT Test Cases',
        facultyAdvisor: 'ศ.ดร.วิภาดา รัตนกุล',
        companyMentor: 'นายเฉลิมเกียรติ สว่างวงศ์ (Enterprise Solutions Consultant)',
        status: 'approved',
        statusLabel: 'ผ่านการอนุมัติ',
        submittedAt: '2024-10-09T15:10:00.000Z',
        reviewNotes: 'อนุมัติแผนงาน ขอบเขตงานชัดเจน มีการออกแบบระเบียบวิธีการวิเคราะห์ระบบอย่างเป็นแบบแผน'
      }
    ]
  };

  // 2. Application Runtime State
  const state = {
    isApiMode: false,
    activeTab: 'view-positions',
    companies: JSON.parse(JSON.stringify(initialData.companies)),
    positions: JSON.parse(JSON.stringify(initialData.positions)),
    students: JSON.parse(JSON.stringify(initialData.students)),
    cycles: JSON.parse(JSON.stringify(initialData.cycles)),
    plans: JSON.parse(JSON.stringify(initialData.plans)),
    activeCycle: initialData.cycles.find(function (c) { return c.status === 'active'; }) || initialData.cycles[0],
    currentModalPlanId: null
  };

  // Utility helpers
  function showToast(message, type) {
    type = type || 'success';
    const toast = document.getElementById('v2Toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = 'v2-toast show toast-' + type;
    toast.hidden = false;
    setTimeout(function () {
      toast.className = 'v2-toast';
      toast.hidden = true;
    }, 4000);
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function formatThaiDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  // 3. Render Dashboard Summary
  function renderSummaryDashboard() {
    const totalStudents = state.students.length;
    const eligibleStudents = state.students.filter(function (s) { return s.eligibilityStatus === 'eligible'; }).length;
    const eligibilityRate = totalStudents > 0 ? Math.round((eligibleStudents / totalStudents) * 100) : 0;

    const totalCompanies = state.companies.length;
    const mouCompanies = state.companies.filter(function (c) { return Boolean(c.coopMOU); }).length;

    const totalPositions = state.positions.length;
    const totalSlots = state.positions.reduce(function (acc, p) { return acc + (p.capacity || 0); }, 0);

    const totalPlans = state.plans.length;
    const approvedPlans = state.plans.filter(function (p) { return p.status === 'approved'; }).length;

    const elStudents = document.getElementById('statStudentsTotal');
    const elStudentsSub = document.getElementById('statStudentsSubtext');
    if (elStudents) elStudents.textContent = totalStudents + ' คน';
    if (elStudentsSub) elStudentsSub.textContent = 'ผ่านเกณฑ์ความพร้อม ' + eligibilityRate + '% (' + eligibleStudents + ' คน)';

    const elCompanies = document.getElementById('statCompaniesTotal');
    const elCompaniesSub = document.getElementById('statCompaniesSubtext');
    if (elCompanies) elCompanies.textContent = totalCompanies + ' แห่ง';
    if (elCompaniesSub) elCompaniesSub.textContent = 'มี MOU สหกิจ ' + mouCompanies + ' แห่ง';

    const elPositions = document.getElementById('statPositionsTotal');
    const elPositionsSub = document.getElementById('statPositionsSubtext');
    if (elPositions) elPositions.textContent = totalPositions + ' โครงการ';
    if (elPositionsSub) elPositionsSub.textContent = 'รวมโควตารับ ' + totalSlots + ' อัตรา';

    const elActiveCycle = document.getElementById('statActiveCycle');
    const elCycleCountdown = document.getElementById('statCycleCountdown');
    if (elActiveCycle && state.activeCycle) {
      elActiveCycle.textContent = (state.activeCycle.title || 'รอบ 2/2567').replace('รอบสหกิจศึกษา ', '');
    }

    if (elCycleCountdown && state.activeCycle) {
      const deadlineStr = state.activeCycle.applicationDeadline || '2024-11-15';
      const deadline = new Date(deadlineStr);
      const now = new Date('2024-10-20');
      const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 0) {
        elCycleCountdown.textContent = 'ปิดรับแผนใน ' + diffDays + ' วัน (' + formatThaiDate(deadlineStr) + ')';
      } else {
        elCycleCountdown.textContent = 'ครบกำหนดแล้ว (' + formatThaiDate(deadlineStr) + ')';
      }
    }

    const elPlans = document.getElementById('statPlansTotal');
    const elPlansSub = document.getElementById('statPlansSubtext');
    if (elPlans) elPlans.textContent = totalPlans + ' ฉบับ';
    if (elPlansSub) elPlansSub.textContent = 'ผ่านการอนุมัติ ' + approvedPlans + ' แผน';

    const plansBadge = document.getElementById('plansTabBadge');
    if (plansBadge) plansBadge.textContent = totalPlans;
  }

  // 4. Render Positions View
  function renderPositions() {
    const query = (document.getElementById('positionSearchInput')?.value || '').trim().toLowerCase();
    const field = document.getElementById('positionFieldFilter')?.value || 'all';
    const workMode = document.getElementById('positionWorkModeFilter')?.value || 'all';
    const companyId = document.getElementById('positionCompanyFilter')?.value || 'all';

    const filtered = state.positions.filter(function (p) {
      if (field !== 'all' && p.field !== field) return false;
      if (workMode !== 'all' && p.workMode !== workMode) return false;
      if (companyId !== 'all' && p.companyId !== companyId) return false;
      if (query) {
        const text = [p.title, p.companyName, p.field, p.description, (p.requiredSkills || []).join(' ')].join(' ').toLowerCase();
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    });

    const container = document.getElementById('positionsGrid');
    const countText = document.getElementById('positionsResultCount');
    if (countText) countText.textContent = 'พบ ' + filtered.length + ' ตำแหน่ง/โครงการที่เปิดรับ';
    if (!container) return;

    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-magnifying-glass empty-icon"></i><h3>ไม่พบตำแหน่งงานที่ตรงกับเงื่อนไข</h3><p>ลองปรับคำค้นหา หรือล้างตัวกรองสายงานและรูปแบบการทำงาน</p></div>';
      return;
    }

    filtered.forEach(function (pos) {
      const company = state.companies.find(function (c) { return c.id === pos.companyId; });
      const companyLogo = company ? company.image : 'resources/images/logo.png';

      const card = document.createElement('article');
      card.className = 'position-card';

      const skillsHtml = (pos.requiredSkills || []).slice(0, 4).map(function (s) {
        return '<span class="skill-pill">' + s + '</span>';
      }).join('');

      card.innerHTML = 
        '<div class="pos-card-header">' +
          '<div class="pos-card-logo"><img src="' + companyLogo + '" alt="' + pos.companyName + '" loading="lazy" /></div>' +
          '<div class="pos-card-heading">' +
            '<span class="pos-field-tag">' + pos.field + '</span>' +
            '<h3 class="pos-card-title">' + pos.title + '</h3>' +
            '<p class="pos-card-company"><i class="fa-regular fa-building"></i> ' + pos.companyName + '</p>' +
          '</div>' +
        '</div>' +
        '<p class="pos-card-desc">' + pos.description + '</p>' +
        '<div class="pos-meta-row">' +
          '<span class="meta-item"><i class="fa-solid fa-location-dot"></i> ' + pos.location + '</span>' +
          '<span class="meta-item"><i class="fa-solid fa-briefcase"></i> ' + pos.workMode + '</span>' +
          '<span class="meta-item text-success"><i class="fa-solid fa-hand-holding-dollar"></i> ' + pos.stipend + '</span>' +
        '</div>' +
        '<div class="pos-skills-row">' + skillsHtml + '</div>' +
        '<div class="pos-card-footer">' +
          '<span class="pos-capacity-tag">รับ ' + pos.capacity + ' อัตรา (สมัครแล้ว ' + (pos.appliedCount || 0) + ')</span>' +
          '<button type="button" class="btn-view-position" data-pos-id="' + pos.id + '">ดูรายละเอียดและยื่นแผน <i class="fa-solid fa-arrow-right"></i></button>' +
        '</div>';

      card.querySelector('.btn-view-position').addEventListener('click', function () {
        openPositionModal(pos.id);
      });

      container.appendChild(card);
    });
  }

  function openPositionModal(positionId) {
    const pos = state.positions.find(function (p) { return p.id === positionId; });
    if (!pos) return;
    const company = state.companies.find(function (c) { return c.id === pos.companyId; });

    document.getElementById('modalPosField').textContent = pos.field;
    document.getElementById('posModalTitle').textContent = pos.title;
    document.getElementById('modalPosCompany').textContent = (company ? company.name : pos.companyName) + (company ? ' (' + company.category + ')' : '');
    document.getElementById('modalPosDesc').textContent = pos.description;
    document.getElementById('modalPosScope').textContent = pos.projectScope || pos.description;
    document.getElementById('modalPosLocation').textContent = pos.location + (company ? ' - ' + company.address : '');
    document.getElementById('modalPosWorkMode').textContent = 'รูปแบบการทำงาน: ' + pos.workMode;
    document.getElementById('modalPosStipend').textContent = pos.stipend;
    document.getElementById('modalPosCapacity').textContent = 'โควตารับ: ' + pos.capacity + ' อัตรา (สมัครแล้ว ' + (pos.appliedCount || 0) + ' คน)';

    const skillsContainer = document.getElementById('modalPosSkills');
    if (skillsContainer) {
      skillsContainer.innerHTML = (pos.requiredSkills || []).map(function (s) {
        return '<span class="skill-pill">' + s + '</span>';
      }).join('');
    }

    const btnApply = document.getElementById('btnApplyThisPosition');
    if (btnApply) {
      btnApply.onclick = function () {
        closeModal('positionDetailModal');
        openNewPlanModalWithPosition(pos.id, pos.companyId);
      };
    }

    openModal('positionDetailModal');
  }

  // 5. Render Students View
  function renderStudents() {
    const query = (document.getElementById('studentSearchInput')?.value || '').trim().toLowerCase();
    const eligibility = document.getElementById('studentEligibilityFilter')?.value || 'all';
    const year = document.getElementById('studentYearFilter')?.value || 'all';
    const sortBy = document.getElementById('studentSortFilter')?.value || 'name';

    const filtered = state.students.filter(function (s) {
      if (eligibility !== 'all' && s.eligibilityStatus !== eligibility) return false;
      if (year !== 'all' && String(s.year) !== year) return false;
      if (query) {
        const text = [s.id, s.name, s.nameEn, s.major, (s.skills || []).join(' ')].join(' ').toLowerCase();
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    });

    filtered.sort(function (a, b) {
      if (sortBy === 'gpax') return (b.gpax || 0) - (a.gpax || 0);
      if (sortBy === 'creditsCompleted') return (b.creditsCompleted || 0) - (a.creditsCompleted || 0);
      if (sortBy === 'id') return a.id.localeCompare(b.id);
      return a.name.localeCompare(b.name, 'th');
    });

    const tbody = document.getElementById('studentsTableBody');
    const countText = document.getElementById('studentsResultCount');
    if (countText) countText.textContent = 'พบข้อมูลนักศึกษา ' + filtered.length + ' คน';
    if (!tbody) return;

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">ไม่พบข้อมูลนักศึกษาที่ตรงกับคำค้นหาหรือตัวกรอง</td></tr>';
      return;
    }

    filtered.forEach(function (student) {
      let badgeClass = 'badge-eligible';
      let badgeLabel = 'ผ่านเกณฑ์';
      let badgeIcon = 'fa-check';

      if (student.eligibilityStatus === 'conditional') {
        badgeClass = 'badge-conditional';
        badgeLabel = 'รอตรวจสอบ';
        badgeIcon = 'fa-clock';
      } else if (student.eligibilityStatus === 'ineligible') {
        badgeClass = 'badge-ineligible';
        badgeLabel = 'ไม่ผ่านเกณฑ์';
        badgeIcon = 'fa-xmark';
      }

      const planText = student.currentPlanId
        ? '<span class="text-success"><i class="fa-solid fa-file-circle-check"></i> ยื่นแล้ว</span>'
        : '<span class="text-muted"><i class="fa-regular fa-clock"></i> ยังไม่ยื่น</span>';

      const tr = document.createElement('tr');
      tr.innerHTML = 
        '<td><strong class="font-mono">' + student.id + '</strong></td>' +
        '<td><div class="student-name-group"><strong>' + student.name + '</strong><span class="text-muted text-xs">' + (student.nameEn || '') + '</span></div></td>' +
        '<td><span class="major-pill">' + student.major + '</span></td>' +
        '<td>ชั้นปี ' + student.year + '</td>' +
        '<td><strong>' + (student.gpax || 0).toFixed(2) + '</strong></td>' +
        '<td>' + student.creditsCompleted + ' นก.</td>' +
        '<td><span class="badge-status ' + badgeClass + '" title="' + (student.eligibilityReason || '') + '"><i class="fa-solid ' + badgeIcon + '"></i> ' + badgeLabel + '</span></td>' +
        '<td>' + planText + '</td>' +
        '<td><button type="button" class="btn-table-action" data-student-id="' + student.id + '" title="ดูรายละเอียด"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></td>';

      tr.querySelector('.btn-table-action').addEventListener('click', function () {
        openStudentModal(student.id);
      });

      tbody.appendChild(tr);
    });
  }

  function openStudentModal(studentId) {
    const student = state.students.find(function (s) { return s.id === studentId; });
    if (!student) return;

    document.getElementById('studentModalTitle').textContent = (student.prefix || '') + student.name;
    document.getElementById('studentModalId').textContent = 'รหัสนักศึกษา: ' + student.id + ' · สาขา' + student.major;
    document.getElementById('modalStudentCurriculum').textContent = student.curriculum || 'หลักสูตรวิทยาการคอมพิวเตอร์';
    document.getElementById('modalStudentEligibilityReason').textContent = student.eligibilityReason || '';
    document.getElementById('modalStudentGpax').textContent = (student.gpax || 0).toFixed(2);
    document.getElementById('modalStudentCredits').textContent = student.creditsCompleted + ' หน่วยกิต';
    document.getElementById('modalStudentYear').textContent = 'ปีที่ ' + student.year;
    document.getElementById('modalStudentContact').textContent = 'อีเมล: ' + (student.contact?.email || '-') + ' | โทร: ' + (student.contact?.phone || '-');

    const statusBadge = document.getElementById('modalStudentStatusBadge');
    if (statusBadge) {
      if (student.eligibilityStatus === 'eligible') {
        statusBadge.className = 'badge-status badge-eligible';
        statusBadge.innerHTML = '<i class="fa-solid fa-check"></i> ผ่านเกณฑ์ความพร้อมสหกิจ';
      } else if (student.eligibilityStatus === 'conditional') {
        statusBadge.className = 'badge-status badge-conditional';
        statusBadge.innerHTML = '<i class="fa-solid fa-clock"></i> รอตรวจสอบ / มีเงื่อนไข';
      } else {
        statusBadge.className = 'badge-status badge-ineligible';
        statusBadge.innerHTML = '<i class="fa-solid fa-xmark"></i> ไม่ผ่านเกณฑ์คุณสมบัติ';
      }
    }

    const skillsWrap = document.getElementById('modalStudentSkills');
    if (skillsWrap) {
      skillsWrap.innerHTML = (student.skills || []).map(function (sk) {
        return '<span class="skill-pill">' + sk + '</span>';
      }).join('');
    }

    const planContainer = document.getElementById('modalStudentPlanDetails');
    const btnSubmit = document.getElementById('btnStudentSubmitPlan');

    if (student.currentPlanId) {
      const plan = state.plans.find(function (p) { return p.id === student.currentPlanId; });
      if (plan && planContainer) {
        planContainer.innerHTML = 
          '<div class="linked-plan-box">' +
            '<div class="linked-plan-header"><strong>' + plan.id + ': ' + plan.positionTitle + '</strong><span class="badge-status badge-status-' + plan.status + '">' + plan.statusLabel + '</span></div>' +
            '<p class="text-sm mt-1"><strong>สถานประกอบการ:</strong> ' + plan.companyName + '</p>' +
            '<p class="text-sm"><strong>หัวข้อโครงงาน:</strong> ' + plan.proposedTopic + '</p>' +
            '<p class="text-xs text-muted mt-1">ยื่นเมื่อ ' + formatThaiDate(plan.submittedAt) + ' · ที่ปรึกษา: ' + plan.facultyAdvisor + '</p>' +
          '</div>';
      }
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="fa-solid fa-check"></i> นักศึกษายื่นแผนในรอบนี้แล้ว';
      }
    } else {
      if (planContainer) {
        planContainer.innerHTML = '<p class="text-muted text-sm"><i class="fa-regular fa-circle-question"></i> ยังไม่มีการยื่นแผนสหกิจศึกษาในรอบปัจจุบัน</p>';
      }
      if (btnSubmit) {
        if (student.eligibilityStatus === 'ineligible') {
          btnSubmit.disabled = true;
          btnSubmit.innerHTML = '<i class="fa-solid fa-ban"></i> ไม่สามารถยื่นแผนได้ (ไม่ผ่านเกณฑ์)';
        } else {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<i class="fa-solid fa-paper-plane"></i> เสนอยื่นแผนสหกิจให้นักศึกษานี้';
          btnSubmit.onclick = function () {
            closeModal('studentDetailModal');
            openNewPlanModalWithStudent(student.id);
          };
        }
      }
    }

    openModal('studentDetailModal');
  }

  // 6. Render Cycles & Timeline
  function renderCycles() {
    const activeCycle = state.activeCycle || state.cycles[0];
    const container = document.getElementById('activeCycleCard');

    if (container && activeCycle) {
      container.innerHTML = 
        '<div class="spotlight-header">' +
          '<span class="badge-cycle-active"><i class="fa-solid fa-bolt"></i> รอบการศึกษาปัจจุบัน</span>' +
          '<h2>' + activeCycle.title + '</h2>' +
          '<p class="spotlight-desc">' + activeCycle.description + '</p>' +
        '</div>' +
        '<div class="spotlight-dates-grid">' +
          '<div class="date-item"><span class="date-label">เปิดรับสมัครและยื่นแผน</span><span class="date-value">' + formatThaiDate(activeCycle.applicationStart) + ' - ' + formatThaiDate(activeCycle.applicationDeadline) + '</span></div>' +
          '<div class="date-item"><span class="date-label">ประกาศผลการอนุมัติ</span><span class="date-value">' + formatThaiDate(activeCycle.approvalAnnouncement) + '</span></div>' +
          '<div class="date-item"><span class="date-label">ช่วงเวลาปฏิบัติงานจริง (16 สัปดาห์)</span><span class="date-value">' + formatThaiDate(activeCycle.coopStart) + ' - ' + formatThaiDate(activeCycle.coopEnd) + '</span></div>' +
          '<div class="date-item"><span class="date-label">กลุ่มเป้าหมาย</span><span class="date-value">' + activeCycle.targetAudience + '</span></div>' +
        '</div>';
    }

    const timelineContainer = document.getElementById('milestonesTimeline');
    if (timelineContainer && activeCycle && activeCycle.milestones) {
      timelineContainer.innerHTML = activeCycle.milestones.map(function (ms) {
        return '<div class="timeline-milestone milestone-' + ms.status + '">' +
          '<div class="milestone-bullet"><span>' + ms.step + '</span></div>' +
          '<div class="milestone-content">' +
            '<div class="milestone-header"><h3 class="milestone-title">' + ms.title + '</h3><span class="milestone-status-badge badge-' + ms.status + '">' + ms.statusLabel + '</span></div>' +
            '<p class="milestone-date"><i class="fa-regular fa-calendar"></i> กำหนดส่ง: ' + formatThaiDate(ms.deadline) + '</p>' +
            '<p class="milestone-desc">' + ms.description + '</p>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  }

  // 7. Render Plans View
  function renderPlans() {
    const query = (document.getElementById('planSearchInput')?.value || '').trim().toLowerCase();
    const status = document.getElementById('planStatusFilter')?.value || 'all';
    const cycleId = document.getElementById('planCycleFilter')?.value || 'all';
    const companyId = document.getElementById('planCompanyFilter')?.value || 'all';

    const filtered = state.plans.filter(function (p) {
      if (status !== 'all' && p.status !== status) return false;
      if (cycleId !== 'all' && p.cycleId !== cycleId) return false;
      if (companyId !== 'all' && p.companyId !== companyId) return false;
      if (query) {
        const text = [p.id, p.studentName, p.companyName, p.positionTitle, p.proposedTopic, p.facultyAdvisor].join(' ').toLowerCase();
        if (text.indexOf(query) === -1) return false;
      }
      return true;
    });

    const container = document.getElementById('plansList');
    const countText = document.getElementById('plansResultCount');
    if (countText) countText.textContent = 'พบแผนสหกิจศึกษา ' + filtered.length + ' รายการ';
    if (!container) return;

    container.innerHTML = '';

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fa-solid fa-file-circle-question empty-icon"></i><h3>ไม่พบแผนสหกิจศึกษาที่ตรงกับเงื่อนไข</h3><p>ลองปรับคำค้นหา หรือกดปุ่ม "ยื่นแผนสหกิจศึกษาใหม่" เพื่อเพิ่มข้อมูลแผน</p></div>';
      return;
    }

    filtered.forEach(function (plan) {
      let statusClass = 'badge-status-approved';
      let statusIcon = 'fa-circle-check';
      if (plan.status === 'pending') {
        statusClass = 'badge-status-pending';
        statusIcon = 'fa-clock';
      } else if (plan.status === 'needs_revision') {
        statusClass = 'badge-status-revision';
        statusIcon = 'fa-circle-exclamation';
      }

      const card = document.createElement('article');
      card.className = 'plan-card';
      card.innerHTML = 
        '<div class="plan-card-header">' +
          '<div>' +
            '<div class="plan-code-row"><span class="plan-id-tag">' + plan.id + '</span><span class="plan-cycle-tag">' + (plan.cycleTitle || 'รอบ 2/2567') + '</span></div>' +
            '<h3 class="plan-card-topic">' + plan.proposedTopic + '</h3>' +
          '</div>' +
          '<span class="badge-status ' + statusClass + '"><i class="fa-solid ' + statusIcon + '"></i> ' + plan.statusLabel + '</span>' +
        '</div>' +
        '<div class="plan-card-body">' +
          '<div class="plan-detail-cell"><span class="cell-label"><i class="fa-solid fa-user-graduate"></i> นักศึกษา:</span><strong>' + plan.studentName + '</strong> (รหัส ' + plan.studentId + ')</div>' +
          '<div class="plan-detail-cell"><span class="cell-label"><i class="fa-solid fa-building"></i> สถานประกอบการ:</span><strong>' + plan.companyName + '</strong> - ' + plan.positionTitle + '</div>' +
          '<div class="plan-detail-cell"><span class="cell-label"><i class="fa-solid fa-user-tie"></i> อาจารย์ที่ปรึกษา:</span>' + (plan.facultyAdvisor || 'สาขาวิชาวิทยาการคอมพิวเตอร์') + '</div>' +
        '</div>' +
        '<div class="plan-card-footer">' +
          '<span class="text-xs text-muted">ยื่นเมื่อ: ' + formatThaiDate(plan.submittedAt) + '</span>' +
          '<button type="button" class="btn-view-plan" data-plan-id="' + plan.id + '">ตรวจสอบรายละเอียดและผลพิจารณา <i class="fa-solid fa-arrow-right"></i></button>' +
        '</div>';

      card.querySelector('.btn-view-plan').addEventListener('click', function () {
        openPlanModal(plan.id);
      });

      container.appendChild(card);
    });
  }

  function openPlanModal(planId) {
    const plan = state.plans.find(function (p) { return p.id === planId; });
    if (!plan) return;
    state.currentModalPlanId = planId;

    document.getElementById('planModalTitle').textContent = 'แผนสหกิจศึกษา: ' + plan.id;
    document.getElementById('modalPlanCycleTag').textContent = plan.cycleTitle || 'รอบสหกิจ 2/2567';
    document.getElementById('modalPlanStudent').textContent = 'ผู้เสนอแผน: ' + plan.studentName + ' (รหัส ' + plan.studentId + ')';
    document.getElementById('modalPlanTopic').textContent = plan.proposedTopic;
    document.getElementById('modalPlanObjective').textContent = plan.objective;
    document.getElementById('modalPlanCompany').textContent = plan.companyName;
    document.getElementById('modalPlanPosition').textContent = 'ตำแหน่ง: ' + plan.positionTitle;
    document.getElementById('modalPlanAdvisor').textContent = plan.facultyAdvisor || '-';
    document.getElementById('modalPlanMentor').textContent = plan.companyMentor || '-';
    document.getElementById('modalPlanReviewNotes').textContent = plan.reviewNotes || 'ไม่มีข้อคิดเห็นเพิ่มเติม';
    document.getElementById('modalPlanDate').textContent = 'ยื่นเมื่อ: ' + formatThaiDate(plan.submittedAt);

    const statusBadge = document.getElementById('modalPlanStatusBadge');
    if (statusBadge) {
      statusBadge.className = 'badge-status badge-status-' + plan.status;
      statusBadge.textContent = plan.statusLabel;
    }

    const btnApprove = document.getElementById('btnReviewApprove');
    const btnRevision = document.getElementById('btnReviewRevision');

    if (btnApprove) {
      btnApprove.onclick = function () {
        updatePlanStatus(plan.id, 'approved', 'คณะกรรมการพิจารณาอนุมัติแผนสหกิจศึกษาเรียบร้อย');
      };
    }

    if (btnRevision) {
      btnRevision.onclick = function () {
        updatePlanStatus(plan.id, 'needs_revision', 'โปรดปรับปรุงรายละเอียดวัตถุประสงค์และระเบียบวิธีวิจัยให้ชัดเจนยิ่งขึ้น');
      };
    }

    openModal('planDetailModal');
  }

  function updatePlanStatus(planId, newStatus, notes) {
    const plan = state.plans.find(function (p) { return p.id === planId; });
    if (plan) {
      plan.status = newStatus;
      plan.statusLabel = newStatus === 'approved' ? 'ผ่านการอนุมัติ' : 'ส่งกลับแก้ไข';
      plan.reviewNotes = notes;
      plan.updatedAt = new Date().toISOString();
      showToast('อัปเดตสถานะแผนเป็น "' + plan.statusLabel + '" สำเร็จ', 'success');
      closeModal('planDetailModal');
      renderSummaryDashboard();
      renderPlans();
    }
  }

  // 8. New Plan Modal Populators
  function populateNewPlanFormSelectors() {
    const studentSelect = document.getElementById('formStudentSelect');
    if (studentSelect) {
      studentSelect.innerHTML = '<option value="">-- กรุณาเลือกนักศึกษา (เฉพาะผู้มีสิทธิ์) --</option>';
      state.students.forEach(function (s) {
        const opt = document.createElement('option');
        opt.value = s.id;
        const note = s.eligibilityStatus === 'eligible' ? '(ผ่านเกณฑ์)' : s.eligibilityStatus === 'conditional' ? '(รอตรวจสอบ)' : '(ไม่ผ่านเกณฑ์)';
        opt.textContent = s.id + ' - ' + s.name + ' ' + note + (s.currentPlanId ? ' [ยื่นแผนแล้ว]' : '');
        if (s.eligibilityStatus === 'ineligible' || s.currentPlanId) {
          opt.disabled = true;
        }
        studentSelect.appendChild(opt);
      });
    }

    const cycleSelect = document.getElementById('formCycleSelect');
    if (cycleSelect) {
      cycleSelect.innerHTML = '';
      state.cycles.forEach(function (c) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.title + ' (' + c.statusLabel + ')';
        if (c.status === 'active') opt.selected = true;
        cycleSelect.appendChild(opt);
      });
    }

    const companySelect = document.getElementById('formCompanySelect');
    const posSelect = document.getElementById('formPositionSelect');
    if (companySelect && posSelect) {
      companySelect.innerHTML = '<option value="">-- เลือกสถานประกอบการเป้าหมาย --</option>';
      state.companies.forEach(function (comp) {
        const opt = document.createElement('option');
        opt.value = comp.id;
        opt.textContent = comp.name + ' (' + (comp.category || comp.location) + ')';
        companySelect.appendChild(opt);
      });

      companySelect.onchange = function () {
        const compId = companySelect.value;
        posSelect.innerHTML = '';
        if (!compId) {
          posSelect.disabled = true;
          posSelect.innerHTML = '<option value="">-- กรุณาเลือกสถานประกอบการก่อน --</option>';
          return;
        }
        posSelect.disabled = false;
        const matching = state.positions.filter(function (p) { return p.companyId === compId; });
        if (matching.length === 0) {
          posSelect.innerHTML = '<option value="">-- ไม่มีตำแหน่งเปิดรับ --</option>';
        } else {
          posSelect.innerHTML = '<option value="">-- เลือกตำแหน่ง / โครงการ --</option>';
          matching.forEach(function (pos) {
            const opt = document.createElement('option');
            opt.value = pos.id;
            opt.textContent = pos.title + ' (รับ ' + pos.capacity + ' อัตรา)';
            posSelect.appendChild(opt);
          });
        }
      };
    }
  }

  function openNewPlanModalWithStudent(studentId) {
    populateNewPlanFormSelectors();
    const select = document.getElementById('formStudentSelect');
    if (select) select.value = studentId;
    openModal('newPlanModal');
  }

  function openNewPlanModalWithPosition(positionId, companyId) {
    populateNewPlanFormSelectors();
    const compSelect = document.getElementById('formCompanySelect');
    const posSelect = document.getElementById('formPositionSelect');
    if (compSelect) {
      compSelect.value = companyId;
      compSelect.dispatchEvent(new Event('change'));
    }
    if (posSelect) {
      posSelect.value = positionId;
    }
    openModal('newPlanModal');
  }

  function handleNewPlanSubmit(event) {
    event.preventDefault();

    const studentId = document.getElementById('formStudentSelect')?.value;
    const cycleId = document.getElementById('formCycleSelect')?.value;
    const companyId = document.getElementById('formCompanySelect')?.value;
    const positionId = document.getElementById('formPositionSelect')?.value;
    const proposedTopic = (document.getElementById('formProposedTopic')?.value || '').trim();
    const objective = (document.getElementById('formObjective')?.value || '').trim();
    const facultyAdvisor = (document.getElementById('formAdvisor')?.value || '').trim() || 'อาจารย์ที่ปรึกษาสหกิจประจำสาขาวิชา';
    const companyMentor = (document.getElementById('formMentor')?.value || '').trim() || 'พนักงานพี่เลี้ยง ณ สถานประกอบการ';

    const errAlert = document.getElementById('formErrorMessage');
    const succAlert = document.getElementById('formSuccessMessage');
    if (errAlert) errAlert.hidden = true;
    if (succAlert) succAlert.hidden = true;

    if (!studentId || !cycleId || !companyId || !positionId || !proposedTopic || !objective) {
      if (errAlert) {
        errAlert.textContent = 'กรุณากรอกข้อมูลที่จำเป็นให้ครบทุกช่องที่มีเครื่องหมายดอกจัน (*)';
        errAlert.hidden = false;
      }
      return;
    }

    const student = state.students.find(function (s) { return s.id === studentId; });
    const company = state.companies.find(function (c) { return c.id === companyId; });
    const position = state.positions.find(function (p) { return p.id === positionId; });
    const cycle = state.cycles.find(function (c) { return c.id === cycleId; });

    const planSeq = String(state.plans.length + 1).padStart(3, '0');
    const planId = 'plan-2567-' + planSeq;
    const now = new Date().toISOString();

    const newPlan = {
      id: planId,
      studentId: studentId,
      studentName: student ? student.name : 'นักศึกษา',
      studentMajor: student ? student.major : 'วิทยาการคอมพิวเตอร์',
      studentGpax: student ? student.gpax : 3.0,
      cycleId: cycleId,
      cycleTitle: cycle ? cycle.title : 'รอบสหกิจศึกษา',
      companyId: companyId,
      companyName: company ? company.name : 'สถานประกอบการ',
      positionId: positionId,
      positionTitle: position ? position.title : 'ตำแหน่งสหกิจ',
      proposedTopic: proposedTopic,
      objective: objective,
      facultyAdvisor: facultyAdvisor,
      companyMentor: companyMentor,
      status: 'pending',
      statusLabel: 'รอการพิจารณา',
      submittedAt: now,
      updatedAt: now,
      reviewNotes: 'ระบบได้รับแผนสหกิจศึกษาเรียบร้อย อยู่ระหว่างรอการตรวจสอบโดยคณะกรรมการ'
    };

    state.plans.unshift(newPlan);
    if (student) student.currentPlanId = planId;
    if (position && typeof position.appliedCount === 'number') position.appliedCount += 1;

    if (succAlert) {
      succAlert.textContent = 'ยื่นแผนสหกิจศึกษาสำเร็จ! รหัสแผน: ' + planId;
      succAlert.hidden = false;
    }

    showToast('ยื่นแผนสหกิจศึกษารหัส ' + planId + ' สำเร็จ!', 'success');
    document.getElementById('newPlanForm')?.reset();

    setTimeout(function () {
      closeModal('newPlanModal');
      renderSummaryDashboard();
      renderPlans();
      renderStudents();
      switchTab('view-plans');
    }, 1200);
  }

  // 9. Tab Switching & Event Setup
  function switchTab(targetViewId) {
    state.activeTab = targetViewId;

    document.querySelectorAll('.v2-tab-btn').forEach(function (btn) {
      const isTarget = btn.getAttribute('data-target') === targetViewId;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', String(isTarget));
    });

    document.querySelectorAll('.v2-tab-panel').forEach(function (panel) {
      const isTarget = panel.id === targetViewId;
      panel.classList.toggle('active', isTarget);
      panel.hidden = !isTarget;
    });

    if (targetViewId === 'view-positions') renderPositions();
    else if (targetViewId === 'view-students') renderStudents();
    else if (targetViewId === 'view-cycles') renderCycles();
    else if (targetViewId === 'view-plans') renderPlans();
  }

  function setupEvents() {
    document.querySelectorAll('.v2-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-target');
        if (target) {
          switchTab(target);
          if (history.replaceState) {
            history.replaceState(null, '', '#' + target.replace('view-', ''));
          }
        }
      });
    });

    // Stat cards clickable jump
    document.querySelectorAll('[data-jump-tab]').forEach(function (card) {
      card.addEventListener('click', function () {
        const target = card.getAttribute('data-jump-tab');
        if (target) {
          switchTab(target);
          if (history.replaceState) {
            history.replaceState(null, '', '#' + target.replace('view-', ''));
          }
          const nav = document.querySelector('.v2-tabs-nav');
          if (nav) nav.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    // Hash navigation
    function handleHash() {
      const hash = (window.location.hash || '').replace('#', '').toLowerCase();
      if (!hash) return;
      if (hash === 'students' || hash === 'view-students') switchTab('view-students');
      else if (hash === 'positions' || hash === 'view-positions') switchTab('view-positions');
      else if (hash === 'cycles' || hash === 'view-cycles') switchTab('view-cycles');
      else if (hash === 'plans' || hash === 'view-plans') switchTab('view-plans');
    }
    window.addEventListener('hashchange', handleHash);
    handleHash();

    // Positions search/filters
    const posSearch = document.getElementById('positionSearchInput');
    const posField = document.getElementById('positionFieldFilter');
    const posMode = document.getElementById('positionWorkModeFilter');
    const posComp = document.getElementById('positionCompanyFilter');
    const btnResetPos = document.getElementById('btnResetPositionFilters');

    let posTimer = null;
    posSearch?.addEventListener('input', function () {
      clearTimeout(posTimer);
      posTimer = setTimeout(renderPositions, 200);
    });
    posField?.addEventListener('change', renderPositions);
    posMode?.addEventListener('change', renderPositions);
    posComp?.addEventListener('change', renderPositions);

    btnResetPos?.addEventListener('click', function () {
      if (posSearch) posSearch.value = '';
      if (posField) posField.value = 'all';
      if (posMode) posMode.value = 'all';
      if (posComp) posComp.value = 'all';
      renderPositions();
    });

    // Students search/filters
    const stuSearch = document.getElementById('studentSearchInput');
    const stuElig = document.getElementById('studentEligibilityFilter');
    const stuYear = document.getElementById('studentYearFilter');
    const stuSort = document.getElementById('studentSortFilter');

    let stuTimer = null;
    stuSearch?.addEventListener('input', function () {
      clearTimeout(stuTimer);
      stuTimer = setTimeout(renderStudents, 200);
    });
    stuElig?.addEventListener('change', renderStudents);
    stuYear?.addEventListener('change', renderStudents);
    stuSort?.addEventListener('change', renderStudents);

    // Plans search/filters
    const planSearch = document.getElementById('planSearchInput');
    const planStatus = document.getElementById('planStatusFilter');
    const planCycle = document.getElementById('planCycleFilter');
    const planComp = document.getElementById('planCompanyFilter');

    let planTimer = null;
    planSearch?.addEventListener('input', function () {
      clearTimeout(planTimer);
      planTimer = setTimeout(renderPlans, 200);
    });
    planStatus?.addEventListener('change', renderPlans);
    planCycle?.addEventListener('change', renderPlans);
    planComp?.addEventListener('change', renderPlans);

    // Modal open buttons
    const openPlanAction = function () {
      populateNewPlanFormSelectors();
      openModal('newPlanModal');
    };

    document.getElementById('btnOpenNewPlanHeader')?.addEventListener('click', openPlanAction);
    document.getElementById('btnOpenNewPlanModal')?.addEventListener('click', openPlanAction);
    document.getElementById('btnOpenPlanModalFromView')?.addEventListener('click', openPlanAction);

    // Modal close buttons
    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const modalId = btn.getAttribute('data-close');
        if (modalId) closeModal(modalId);
      });
    });

    document.querySelectorAll('.v2-modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.v2-modal-overlay:not([hidden])').forEach(function (m) {
          closeModal(m.id);
        });
      }
    });

    document.getElementById('btnRefreshData')?.addEventListener('click', function () {
      showToast('รีเฟรชข้อมูลเรียบร้อย', 'success');
      renderSummaryDashboard();
      renderPositions();
      renderStudents();
      renderCycles();
      renderPlans();
    });

    document.getElementById('newPlanForm')?.addEventListener('submit', handleNewPlanSubmit);
  }

  function populateDropdownFilters() {
    const posCompanyFilter = document.getElementById('positionCompanyFilter');
    if (posCompanyFilter) {
      posCompanyFilter.innerHTML = '<option value="all">ทุกสถานประกอบการ</option>';
      state.companies.forEach(function (comp) {
        const opt = document.createElement('option');
        opt.value = comp.id;
        opt.textContent = comp.name;
        posCompanyFilter.appendChild(opt);
      });
    }

    const planCompanyFilter = document.getElementById('planCompanyFilter');
    if (planCompanyFilter) {
      planCompanyFilter.innerHTML = '<option value="all">ทุกสถานประกอบการ</option>';
      state.companies.forEach(function (comp) {
        const opt = document.createElement('option');
        opt.value = comp.id;
        opt.textContent = comp.name;
        planCompanyFilter.appendChild(opt);
      });
    }

    const planCycleFilter = document.getElementById('planCycleFilter');
    if (planCycleFilter) {
      planCycleFilter.innerHTML = '<option value="all">ทุกรอบเวลา</option>';
      state.cycles.forEach(function (c) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.title;
        if (c.status === 'active') opt.selected = true;
        planCycleFilter.appendChild(opt);
      });
    }
  }

  // 10. Bootstrap
  function init() {
    // 1. Immediately populate filters & render ALL views from embedded data
    populateDropdownFilters();
    renderSummaryDashboard();
    renderPositions();
    renderStudents();
    renderCycles();
    renderPlans();
    setupEvents();

    // 2. Set status badge
    const badge = document.getElementById('connectionBadge');
    const text = document.getElementById('connectionText');

    // 3. Try to connect to Local Compute Server if running on HTTP
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      fetch('/api/health')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.status === 'ok') {
            state.isApiMode = true;
            if (badge && text) {
              badge.className = 'connection-status-badge api-mode';
              text.textContent = 'Local Compute API เชื่อมต่อสำเร็จ (v' + (data.version || '2.0') + ')';
            }
          }
        })
        .catch(function () {
          // Keep local embedded fallback
          if (badge && text) {
            badge.className = 'connection-status-badge fallback-mode';
            text.textContent = 'โหมดข้อมูลออฟไลน์ในเครื่อง (พร้อมใช้งาน)';
          }
        });
    } else {
      if (badge && text) {
        badge.className = 'connection-status-badge fallback-mode';
        text.textContent = 'โหมดข้อมูลออฟไลน์ในเครื่อง (พร้อมใช้งาน)';
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

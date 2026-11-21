const term = 'AY 2026-2027 T1';

const courses = [
  { code: 'STDISM', title: 'Distributed Systems', section: 'S11', faculty: 'Prof. Reyes', units: 3, term, capacity: 3 },
  { code: 'CSNETWK', title: 'Computer Networks', section: 'S12', faculty: 'Prof. Santos', units: 3, term, capacity: 4 },
  { code: 'CSALGCM', title: 'Algorithms and Complexity', section: 'S13', faculty: 'Prof. Cruz', units: 3, term, capacity: 2 },
  { code: 'MACHINE', title: 'Machine Learning', section: 'S14', faculty: 'Prof. Reyes', units: 3, term, capacity: 5 }
];

const users = [
  { id: '2026-001', username: 'student1', name: 'Alice Dela Cruz', role: 'student', password: 'hotdog1' },
  { id: '2026-002', username: 'student2', name: 'Bob Santos', role: 'student', password: 'hotdog1' },
  { id: '2026-003', username: 'student3', name: 'Charlie Lim', role: 'student', password: 'hotdog1' },
  { id: 'FAC-001', username: 'prof1', name: 'Prof. Reyes', role: 'faculty', password: 'hotdog1' }
];

module.exports = { courses, users, term };

const { openDb } = require('../shared/db');
const { courses, users } = require('../shared/seed');
const { grpc, rpcError, serve } = require('../shared/grpc');
const { authorized, handle } = require('../shared/auth');

const db = openDb('grades');
db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS courses (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    term TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grades (
    student_id TEXT NOT NULL REFERENCES students(id),
    course_code TEXT NOT NULL REFERENCES courses(code),
    term TEXT NOT NULL,
    grade REAL NOT NULL CHECK(grade >= 0 AND grade <= 100),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (student_id, course_code, term)
  )
`);

for (const user of users.filter(user => user.role === 'student')) {
  db.prepare('INSERT OR IGNORE INTO students VALUES (?, ?)').run(user.id, user.name);
}

for (const course of courses) {
  db.prepare('INSERT OR IGNORE INTO courses VALUES (?, ?, ?)').run(course.code, course.title, course.term);
}

db.prepare('INSERT OR IGNORE INTO grades VALUES (?, ?, ?, ?, ?)')
  .run('2026-001', 'STDISM', 'AY 2025-2026 T3', 93, '2026-06-18T12:00:00.000Z');
db.prepare('INSERT OR IGNORE INTO grades VALUES (?, ?, ?, ?, ?)')
  .run('2026-001', 'CSNETWK', 'AY 2025-2026 T3', 88, '2026-06-18T12:00:00.000Z');
db.prepare('INSERT OR IGNORE INTO grades VALUES (?, ?, ?, ?, ?)')
  .run('2026-002', 'STDISM', 'AY 2025-2026 T3', 91, '2026-06-18T12:00:00.000Z');

serve('GradeService', {
  listMine(call, callback) {
    handle(callback, () => {
      const user = authorized(call, 'student');
      const grades = db.prepare(`
        SELECT g.student_id AS studentId, g.course_code AS courseCode, c.title AS courseTitle,
               g.term, g.grade, g.updated_at AS updatedAt
        FROM grades g JOIN courses c ON c.code = g.course_code
        WHERE g.student_id = ? ORDER BY g.updated_at DESC
      `).all(user.sub);
      return { grades };
    });
  },
  listStudents(call, callback) {
    handle(callback, () => {
      authorized(call, 'faculty');
      return {
        students: db.prepare('SELECT id AS userId, name FROM students ORDER BY name').all(),
        courses: db.prepare('SELECT code, title, term FROM courses ORDER BY code').all()
      };
    });
  },
  uploadGrade(call, callback) {
    handle(callback, () => {
      authorized(call, 'faculty');
      const studentId = String(call.request.studentId || '').trim();
      const courseCode = String(call.request.courseCode || '').trim().toUpperCase();
      const term = String(call.request.term || '').trim();
      const grade = Number(call.request.grade);
      const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
      const course = db.prepare('SELECT code FROM courses WHERE code = ?').get(courseCode);
      if (!student || !course || !term || term.length > 50 || !Number.isFinite(grade) || grade < 0 || grade > 100) {
        throw rpcError(grpc.status.INVALID_ARGUMENT, 'Select a valid student, course, term and grade from 0 to 100.');
      }
      db.prepare(`
        INSERT INTO grades (student_id, course_code, term, grade, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(student_id, course_code, term)
        DO UPDATE SET grade = excluded.grade, updated_at = excluded.updated_at
      `).run(studentId, courseCode, term, grade, new Date().toISOString());
      return { message: `Grade saved for ${studentId} in ${courseCode}.` };
    });
  }
}, Number(process.env.GRADES_PORT || 50054));

const { openDb } = require('../shared/db');
const { courses } = require('../shared/seed');
const { grpc, rpcError, serve } = require('../shared/grpc');
const { authorized, handle } = require('../shared/auth');

const db = openDb('enrollment');
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    term TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    open INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    course_code TEXT NOT NULL REFERENCES courses(code),
    enrolled_at TEXT NOT NULL,
    UNIQUE(student_id, course_code)
  )
`);

for (const course of courses) {
  db.prepare('INSERT OR IGNORE INTO courses VALUES (?, ?, ?, ?, ?, 1)')
    .run(course.code, course.title, course.section, course.term, course.capacity);
}

serve('EnrollmentService', {
  listMine(call, callback) {
    handle(callback, () => {
      const user = authorized(call, 'student');
      const enrollments = db.prepare(`
        SELECT c.code, c.title, c.section, c.term, e.enrolled_at AS enrolledAt
        FROM enrollments e JOIN courses c ON c.code = e.course_code
        WHERE e.student_id = ? ORDER BY e.enrolled_at DESC
      `).all(user.sub);
      const availableCourses = db.prepare(`
        SELECT c.*, c.capacity - COUNT(e.id) AS seatsLeft
        FROM courses c LEFT JOIN enrollments e ON e.course_code = c.code
        GROUP BY c.code ORDER BY c.code
      `).all().map(course => ({ ...course, open: Boolean(course.open && course.seatsLeft > 0) }));
      return { enrollments, availableCourses };
    });
  },
  enroll(call, callback) {
    handle(callback, () => {
      const user = authorized(call, 'student');
      const code = String(call.request.code || '').trim().toUpperCase();
      db.exec('BEGIN IMMEDIATE');
      try {
        const course = db.prepare('SELECT * FROM courses WHERE code = ?').get(code);
        if (!course || !course.open) throw rpcError(grpc.status.NOT_FOUND, 'This course is not accepting students.');
        const exists = db.prepare('SELECT id FROM enrollments WHERE student_id = ? AND course_code = ?')
          .get(user.sub, code);
        if (exists) throw rpcError(grpc.status.ALREADY_EXISTS, 'You are already enrolled in this course.');
        const { count } = db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE course_code = ?').get(code);
        if (count >= course.capacity) throw rpcError(grpc.status.RESOURCE_EXHAUSTED, 'There are no remaining seats.');
        db.prepare('INSERT INTO enrollments (student_id, course_code, enrolled_at) VALUES (?, ?, ?)')
          .run(user.sub, code, new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { message: `Successfully enrolled in ${code}.` };
    });
  }
}, Number(process.env.ENROLLMENT_PORT || 50053));

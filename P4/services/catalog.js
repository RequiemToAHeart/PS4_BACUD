const { openDb } = require('../shared/db');
const { courses } = require('../shared/seed');
const { serve } = require('../shared/grpc');
const { authorized, handle } = require('../shared/auth');

const db = openDb('catalog');
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    faculty TEXT NOT NULL,
    units INTEGER NOT NULL,
    term TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    open INTEGER NOT NULL DEFAULT 1
  )
`);

for (const course of courses) {
  db.prepare('INSERT OR IGNORE INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
    .run(course.code, course.title, course.section, course.faculty, course.units, course.term, course.capacity);
}

serve('CatalogService', {
  listCourses(call, callback) {
    handle(callback, () => {
      authorized(call);
      return {
        courses: db.prepare('SELECT * FROM courses ORDER BY code').all().map(course => ({
          ...course,
          open: Boolean(course.open),
          seatsLeft: course.capacity
        }))
      };
    });
  }
}, Number(process.env.CATALOG_PORT || 50052));

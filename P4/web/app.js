const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { client, call } = require('../shared/grpc');
const { verify } = require('../shared/auth');

const app = express();
const auth = client('AuthService', process.env.AUTH_ADDRESS || '127.0.0.1:50051');
const catalog = client('CatalogService', process.env.CATALOG_ADDRESS || '127.0.0.1:50052');
const enrollment = client('EnrollmentService', process.env.ENROLLMENT_ADDRESS || '127.0.0.1:50053');
const grades = client('GradeService', process.env.GRADES_ADDRESS || '127.0.0.1:50054');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const token = req.cookies.enrollment_token || '';
  let user = null;
  if (token) {
    try {
      user = verify(token);
    } catch {
      res.clearCookie('enrollment_token');
    }
  }
  res.locals.user = user;
  res.locals.token = token;
  res.locals.notice = req.query.notice || '';
  res.locals.errorMessage = req.query.error || '';
  next();
});

function requireLogin(req, res, next) {
  if (!res.locals.user) return res.redirect('/login');
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (res.locals.user.role !== role) return res.redirect('/dashboard?error=Access%20denied');
    next();
  };
}

function serviceError(error) {
  if (error.code === 14 || error.code === 4) return 'This service is currently offline. Other features are still available.';
  if (error.code === 16) return 'Your session has expired. Please log in again.';
  return error.details || 'The request could not be completed.';
}

async function safeCall(target, method, payload, token) {
  try {
    return { data: await call(target, method, payload, token), error: '' };
  } catch (error) {
    return { data: null, error: serviceError(error) };
  }
}

function withMessage(route, key, message) {
  return `${route}?${key}=${encodeURIComponent(message)}`;
}

app.get('/', (req, res) => res.redirect(res.locals.user ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
  if (res.locals.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign in' });
});

app.post('/login', async (req, res) => {
  const result = await safeCall(auth, 'login', {
    username: req.body.username,
    password: req.body.password
  }, '');
  if (result.error) return res.redirect(withMessage('/login', 'error', result.error));
  res.cookie('enrollment_token', result.data.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 60 * 1000,
    path: '/'
  });
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  res.clearCookie('enrollment_token', { path: '/' });
  res.redirect(withMessage('/login', 'notice', 'You have signed out.'));
});

app.get('/dashboard', requireLogin, async (req, res) => {
  const token = res.locals.token;
  const isStudent = res.locals.user.role === 'student';
  const [courseStatus, enrollmentStatus, gradeStatus] = await Promise.all([
    safeCall(catalog, 'listCourses', {}, token),
    isStudent ? safeCall(enrollment, 'listMine', {}, token) : Promise.resolve(null),
    safeCall(grades, isStudent ? 'listMine' : 'listStudents', {}, token)
  ]);
  res.render('dashboard', { title: 'Dashboard', courseStatus, enrollmentStatus, gradeStatus });
});

app.get('/courses', requireLogin, async (req, res) => {
  const result = await safeCall(catalog, 'listCourses', {}, res.locals.token);
  res.render('courses', { title: 'Course catalog', result });
});

app.get('/enrollments', requireLogin, requireRole('student'), async (req, res) => {
  const result = await safeCall(enrollment, 'listMine', {}, res.locals.token);
  res.render('enrollments', { title: 'Enrollments', result });
});

app.post('/enrollments', requireLogin, requireRole('student'), async (req, res) => {
  const result = await safeCall(enrollment, 'enroll', { code: req.body.code }, res.locals.token);
  res.redirect(withMessage('/enrollments', result.error ? 'error' : 'notice', result.error || result.data.message));
});

app.get('/grades', requireLogin, requireRole('student'), async (req, res) => {
  const result = await safeCall(grades, 'listMine', {}, res.locals.token);
  res.render('grades', { title: 'Previous grades', result });
});

app.get('/faculty', requireLogin, requireRole('faculty'), async (req, res) => {
  const result = await safeCall(grades, 'listStudents', {}, res.locals.token);
  res.render('faculty', { title: 'Upload grades', result });
});

app.post('/faculty', requireLogin, requireRole('faculty'), async (req, res) => {
  const result = await safeCall(grades, 'uploadGrade', {
    studentId: req.body.studentId,
    courseCode: req.body.courseCode,
    term: req.body.term,
    grade: Number(req.body.grade)
  }, res.locals.token);
  res.redirect(withMessage('/faculty', result.error ? 'error' : 'notice', result.error || result.data.message));
});

app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'This page does not exist.' }));

app.use((error, req, res, next) => {
  process.stderr.write(`${error.message}\n`);
  res.status(500).render('error', { title: 'Unexpected error', message: 'Please try again later.' });
});

app.listen(Number(process.env.WEB_PORT || 3000), '0.0.0.0', () => {
  process.stdout.write(`Web MVC node listening on ${process.env.WEB_PORT || 3000}\n`);
});

import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [error, setError] = useState('');

  const [className, setClassName] = useState('');
  const [classTeacherId, setClassTeacherId] = useState('');

  const [subjectName, setSubjectName] = useState('');
  const [subjectClassId, setSubjectClassId] = useState('');
  const [subjectTeacherId, setSubjectTeacherId] = useState('');

  const load = async () => {
    try {
      const [c, s, t] = await Promise.all([api.get('/classes'), api.get('/subjects'), api.get('/teachers')]);
      setClasses(c.classes);
      setSubjects(s.subjects);
      setTeachers(t.teachers);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const createClass = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/classes', { name: className, classTeacherId: classTeacherId || null });
      setClassName('');
      setClassTeacherId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const createSubject = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/subjects', {
        name: subjectName,
        classId: subjectClassId,
        teacherId: subjectTeacherId || null
      });
      setSubjectName('');
      setSubjectClassId('');
      setSubjectTeacherId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <h2>Classes & Subjects</h2>
      {error && <div className="alert error">{error}</div>}

      <div className="two-col">
        <div className="card">
          <h3>Classes</h3>
          <form className="stacked-form" onSubmit={createClass}>
            <input placeholder="Class name (e.g. Grade 5 - A)" value={className} onChange={(e) => setClassName(e.target.value)} required />
            <select value={classTeacherId} onChange={(e) => setClassTeacherId(e.target.value)}>
              <option value="">No class teacher</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
            </select>
            <button type="submit">Add Class</button>
          </form>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Class Teacher</th></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id}><td>{c.name}</td><td>{c.classTeacherName || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Subjects</h3>
          <form className="stacked-form" onSubmit={createSubject}>
            <input placeholder="Subject name" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} required />
            <select value={subjectClassId} onChange={(e) => setSubjectClassId(e.target.value)} required>
              <option value="">Select class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={subjectTeacherId} onChange={(e) => setSubjectTeacherId(e.target.value)}>
              <option value="">No teacher assigned</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
            </select>
            <button type="submit">Add Subject</button>
          </form>
          <table className="data-table">
            <thead><tr><th>Name</th><th>Class</th><th>Teacher</th></tr></thead>
            <tbody>
              {subjects.map((s) => {
                const cls = classes.find((c) => c.id === s.classId);
                return <tr key={s.id}><td>{s.name}</td><td>{cls?.name || '—'}</td><td>{s.teacherName || '—'}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

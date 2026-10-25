import Icon from './Icon';

const FEATURES = [
  { icon: 'attendance', text: 'Daily attendance, visible to parents the moment it is marked' },
  { icon: 'assignments', text: 'Assignments and due dates for every class in one place' },
  { icon: 'announcements', text: 'School-wide and class announcements with instant alerts' },
  { icon: 'shield', text: 'Role-based access: everyone sees only what they should' }
];

export default function AuthShell({ children }) {
  return (
    <div className="auth-screen">
      <section className="auth-brand">
        <div className="brand">
          <span className="brand-mark"><Icon name="heart" size={18} /></span>
          <span>ParentPulse</span>
        </div>
        <div className="auth-pitch">
          <h1>Stay close to every step of the school day.</h1>
          <p>One place for teachers, parents and students to share attendance, homework and news.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.text}>
                <span className="auth-feature-icon"><Icon name={f.icon} size={16} /></span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-brand-foot">Hosted on AWS EC2 · Data in Amazon DynamoDB</p>
      </section>
      <section className="auth-form-side">{children}</section>
    </div>
  );
}

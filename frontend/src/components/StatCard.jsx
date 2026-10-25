import Icon from './Icon';

export default function StatCard({ label, value, icon = 'trend', tone = 'violet' }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <span className="stat-icon"><Icon name={icon} size={20} /></span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

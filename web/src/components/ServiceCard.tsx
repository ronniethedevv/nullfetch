import { Link } from 'react-router-dom';
import { CATEGORIES } from '../abi';
import type { Service } from '../types';

interface Props {
  service: Service;
}

export function ServiceCard({ service }: Props) {
  const categoryName = CATEGORIES[service.category] ?? 'Other';
  const subs = Number(service.subscriberCount);

  return (
    <Link to={`/service/${service.id.toString()}`} className="service-card">
      <div className="service-card__head">
        <span className="service-card__id mono">#{service.id.toString()}</span>
        <span className="service-card__sep mono">·</span>
        <span className="service-card__cat mono">{categoryName}</span>
        {!service.active && (
          <span className="service-card__badge service-card__badge--off mono">
            inactive
          </span>
        )}
      </div>

      <div className="service-card__name">{service.name}</div>

      {service.description && (
        <div className="service-card__desc">
          {service.description.length > 140
            ? service.description.slice(0, 137) + '…'
            : service.description}
        </div>
      )}

      <div className="service-card__foot">
        <span className="service-card__metric mono">
          <span className="service-card__metric-k">subs</span>
          <span className="service-card__metric-v">{subs}</span>
        </span>
        <span className="service-card__arrow mono">→</span>
      </div>
    </Link>
  );
}

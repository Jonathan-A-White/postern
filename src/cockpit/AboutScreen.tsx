// src/cockpit/AboutScreen.tsx — About and credits (mw-vtjxh4.3): opens with Newton's line and one
// sentence on why we credit, then every source Postern is built on (src/credits.ts), each with its
// name as the link, what it is used for, its licence as a link and what we changed.
import { Card, SectionTitle } from '../ui';
import { Screen } from './Shell';
import { CREDIT_GROUPS, FONTS_AND_ICONS, NEWTON, WHY_WE_CREDIT, type Credit } from '../credits';

const LINK = 'text-accent underline underline-offset-2';

function CreditRow({ credit }: { credit: Credit }) {
  return (
    <li className="flex flex-col gap-1 px-4 py-3" data-testid={`credit-${credit.name}`}>
      <a href={credit.url} target="_blank" rel="noreferrer" className={`${LINK} text-[14.5px] font-semibold`}>
        {credit.name}
      </a>
      <p className="text-[13.5px] text-fg">{credit.use}</p>
      <p className="text-[13px] text-muted">
        Licence:{' '}
        <a href={credit.licenceUrl} target="_blank" rel="noreferrer" className={LINK}>
          {credit.licence}
        </a>
      </p>
      <p className="text-[13px] text-muted">Changes: {credit.changes}</p>
    </li>
  );
}

export function AboutScreen() {
  return (
    <Screen title="About and credits" subtitle="What Postern is built on" back={{ view: 'me' }}>
      <div className="flex flex-col gap-6">
        <figure className="flex flex-col gap-2 border-l-2 border-line pl-4">
          <blockquote className="text-[17px] leading-snug font-medium">{NEWTON.quote}</blockquote>
          <figcaption className="text-[13px] text-muted">
            {NEWTON.by}, {NEWTON.source}
          </figcaption>
        </figure>
        <p data-testid="why-we-credit" className="text-[14px] text-fg">
          {WHY_WE_CREDIT}
        </p>

        {CREDIT_GROUPS.map((group) => (
          <section key={group.id} className="flex flex-col gap-2" aria-label={group.title}>
            <SectionTitle>{group.title}</SectionTitle>
            <Card>
              <ul className="divide-y divide-line">
                {group.credits.map((credit) => (
                  <CreditRow key={credit.name} credit={credit} />
                ))}
              </ul>
            </Card>
          </section>
        ))}

        <p data-testid="fonts-and-icons" className="text-[13px] text-muted">
          {FONTS_AND_ICONS}
        </p>
      </div>
    </Screen>
  );
}

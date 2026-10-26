import { useState } from 'react';
import AdminUI, { type AdminSection } from '../AdminUI';

/** AdminUI open on a section, keeping the section it is switched to (the nav is controlled). */
export function AdminHarness({ userRole, section = 'configs' }: { userRole: string; section?: AdminSection }) {
    const [current, setCurrent] = useState<AdminSection>(section);
    return (
        <AdminUI
            open
            onOpenChange={() => {}}
            section={current}
            onSectionChange={setCurrent}
            user={{ id: 'op-1', username: 'ada', role: userRole }}
        />
    );
}

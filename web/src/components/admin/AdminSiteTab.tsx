import { Save } from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion, getMotionProps } from '../../hooks/useReducedMotion';
import { useTheme } from '../../contexts/ThemeContext';

interface AdminSiteTabProps {
    siteConfigs: Record<string, string>;
    setSiteConfigs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    onSubmit: (e: React.FormEvent) => void;
}

export default function AdminSiteTab({ siteConfigs, setSiteConfigs, onSubmit }: AdminSiteTabProps) {
    const reducedMotion = useReducedMotion();
    const { t } = useTheme();

    return (
        <motion.div {...getMotionProps(reducedMotion)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="result-card" style={{ padding: '2rem', maxHeight: 'calc(100vh - 350px)', overflowY: 'auto' }}>
            <form onSubmit={onSubmit} className="form-grid" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* The site-logo upload group was here. Logo upload is
                    deprecated (developer ruling, 17.09.2026): the logo is built
                    from the app name, and the app shell renders the design
                    system's wordmark unconditionally. Removing the operator
                    surface is what stops new uploads; the backend key and its
                    endpoint are untouched, so logos already uploaded still
                    resolve wherever they are still read. */}
                <div className="input-group">
                    <label htmlFor="chat-footer">{t('chatFooterLabel')}</label>
                    <textarea
                        id="chat-footer"
                        value={siteConfigs.chat_footer || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, chat_footer: e.target.value }))}
                        placeholder={t('chatFooterPlaceholder')}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', minHeight: '80px', fontFamily: 'inherit' }}
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="kb-header">{t('kbHeaderLabel')}</label>
                    <textarea
                        id="kb-header"
                        value={siteConfigs.kb_header || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, kb_header: e.target.value }))}
                        placeholder={t('kbHeaderPlaceholder')}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', minHeight: '80px', fontFamily: 'inherit' }}
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="imprint">{t('imprintLabel')}</label>
                    <textarea
                        id="imprint"
                        value={siteConfigs.imprint || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, imprint: e.target.value }))}
                        placeholder={t('imprintPlaceholder')}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', minHeight: '120px', fontFamily: 'inherit' }}
                    />
                </div>

                <div className="input-group">
                    <label htmlFor="example-prompts">{t('examplePromptsLabel')}</label>
                    <textarea
                        id="example-prompts"
                        value={siteConfigs.example_prompts || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, example_prompts: e.target.value }))}
                        placeholder={t('examplePromptsPlaceholder')}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', minHeight: '120px', fontFamily: 'inherit' }}
                    />
                    <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.5rem' }}>{t('examplePromptsHelp')}</p>
                </div>

                <div className="input-group">
                    <label htmlFor="web-proxy">{t('webProxy')}</label>
                    <input
                        id="web-proxy"
                        type="text"
                        value={siteConfigs.web_proxy || ''}
                        onChange={e => setSiteConfigs(prev => ({ ...prev, web_proxy: e.target.value }))}
                        placeholder="http://user:pass@host:port"
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)' }}
                    />
                    <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.5rem' }}>{t('webProxyHelp')}</p>
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.5rem 0' }} />
                <h3 style={{ margin: 0 }}>{t('confluenceSettings')}</h3>

                <div className="input-group">
                    <label htmlFor="confluence-enabled" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                            id="confluence-enabled"
                            type="checkbox"
                            checked={siteConfigs.confluence_enabled === 'true'}
                            onChange={e => setSiteConfigs(prev => ({ ...prev, confluence_enabled: e.target.checked ? 'true' : 'false' }))}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        {t('confluenceEnabled')}
                    </label>
                </div>

                {siteConfigs.confluence_enabled === 'true' && (
                    <div className="input-group">
                        <label htmlFor="confluence-base-url">{t('confluenceBaseUrl')}</label>
                        <input
                            id="confluence-base-url"
                            type="text"
                            value={siteConfigs.confluence_base_url || ''}
                            onChange={e => setSiteConfigs(prev => ({ ...prev, confluence_base_url: e.target.value }))}
                            placeholder={t('confluenceBaseUrlPlaceholder')}
                            style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)' }}
                        />
                    </div>
                )}

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '0.5rem 0' }} />
                <h3 style={{ margin: 0 }}>{t('gitRepoSettings')}</h3>

                <div className="input-group">
                    <label htmlFor="git-repo-enabled" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}>
                        <input
                            id="git-repo-enabled"
                            type="checkbox"
                            checked={siteConfigs.git_repo_enabled === 'true'}
                            onChange={e => setSiteConfigs(prev => ({ ...prev, git_repo_enabled: e.target.checked ? 'true' : 'false' }))}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        {t('gitRepoEnabled')}
                    </label>
                    <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.5rem' }}>{t('gitRepoEnabledHelp')}</p>
                </div>

                <button type="submit" className="search-button" style={{ width: 'fit-content' }}>
                    <Save size={18} /> {t('saveSettings')}
                </button>
            </form>
        </motion.div>
    );
}

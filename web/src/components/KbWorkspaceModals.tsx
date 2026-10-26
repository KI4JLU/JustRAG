import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useKbCore } from '../contexts/KbCoreContext';
import { useKbChat } from '../contexts/KbChatContext';
import { useKbData } from '../contexts/KbDataContext';

const SettingsModal = lazy(() => import('./SettingsModal').then(module => ({ default: module.SettingsModal })));
const ChartModal = lazy(() => import('./ChartModal').then(module => ({ default: module.ChartModal })));
const AbstractGenerationModal = lazy(() => import('./AbstractGenerationModal').then(module => ({ default: module.AbstractGenerationModal })));
const TextSourceViewer = lazy(() => import('./sidebar/TextSourceModal').then(module => ({ default: module.TextSourceViewer })));
const PdfPreviewModal = lazy(() => import('./PdfPreviewModal').then(module => ({ default: module.PdfPreviewModal })));
const MediaPreviewModal = lazy(() => import('./MediaPreviewModal').then(module => ({ default: module.MediaPreviewModal })));
const TablePreviewDialog = lazy(() => import('./tablePreview/TablePreviewDialog').then(module => ({ default: module.TablePreviewDialog })));
const WebWorkspace = lazy(() => import('./WebWorkspace').then(module => ({ default: module.WebWorkspace })));

export function KbWorkspaceModals() {
  const { currentKb, availableConfigs, handleUpdateKBSettings } = useKbCore();
  const { showSettings, setShowSettings } = useKbChat();
  const { content, fileMgmt, webTools } = useKbData();

  return (
    <>
      <Suspense fallback={null}>
        {showSettings && <SettingsModal
          show={showSettings}
          onClose={() => setShowSettings(false)}
          currentKb={currentKb}
          availableConfigs={availableConfigs}
          onUpdateSettings={handleUpdateKBSettings}
        />}
      </Suspense>

      <Suspense fallback={null}>
        {content.showChartGenerationModal && <ChartModal
          show={content.showChartGenerationModal}
          onClose={() => content.setShowChartGenerationModal(false)}
          chartPrompt={content.chartPrompt}
          setChartPrompt={content.setChartPrompt}
          selectedFileId={content.selectedFileId}
          setSelectedFileId={content.setSelectedFileId}
          files={fileMgmt.files}
          onSubmit={content.submitChartGeneration}
        />}
      </Suspense>

      <Suspense fallback={null}>
        {content.showAbstractModal && <AbstractGenerationModal
          show={content.showAbstractModal}
          onClose={() => content.setShowAbstractModal(false)}
          abstractFileId={content.abstractFileId}
          setAbstractFileId={content.setAbstractFileId}
          abstractType={content.abstractType}
          setAbstractType={content.setAbstractType}
          files={fileMgmt.files}
          onSubmit={content.submitAbstractGeneration}
        />}
      </Suspense>

      <Suspense fallback={null}>
        {/* A text source — and a document's extracted text — opens read-only in
            the text editor's window, the PDF preview's twin (TextSourceModal.tsx). */}
        {webTools.showPreviewModal && webTools.previewPage && <TextSourceViewer
          show={webTools.showPreviewModal}
          onClose={() => webTools.setShowPreviewModal(false)}
          fileName={webTools.previewPage.title}
          content={webTools.previewPage.content}
          format={webTools.previewPage.format ?? 'markdown'}
          extractedFrom={webTools.previewPage.extractedFrom}
          origin={webTools.previewPage.origin}
          back={webTools.previewPage.back && {
            trail: webTools.previewPage.back.trail,
            onBack: () => { webTools.setShowPreviewModal(false); webTools.previewPage?.back?.onBack(); },
          }}
        />}
      </Suspense>

      {webTools.showWebWorkspace && currentKb && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50"><Loader2 className="animate-spin text-white" /></div>}>
          <WebWorkspace
            type={webTools.toolTab === 'websearch' ? 'websearch' : 'crawl'}
            results={(webTools.toolTab === 'websearch' ? webTools.searchResults.map(r => ({ ...r, content: r.content ?? '' })) : webTools.crawlResults)}
            selectedUrls={webTools.selectedPages}
            onToggleSelection={(url) => {
              const next = new Set(webTools.selectedPages);
              if (next.has(url)) next.delete(url);
              else next.add(url);
              webTools.setSelectedPages(next);
            }}
            onToggleSelectAll={() => {
              const list = webTools.toolTab === 'websearch' ? webTools.searchResults : webTools.crawlResults;
              if (webTools.selectedPages.size === list.length) {
                webTools.setSelectedPages(new Set());
              } else {
                webTools.setSelectedPages(new Set(list.map(r => r.url)));
              }
            }}
            onAddSources={webTools.handleAddSources}
            onClose={() => webTools.setShowWebWorkspace(false)}
            onUpdateResult={webTools.handleUpdateWebResult}
            onStartEdit={webTools.handleStartEditWebResult}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        {webTools.showPdfPreview && <PdfPreviewModal
          show={webTools.showPdfPreview}
          onClose={() => webTools.setShowPdfPreview(false)}
          fileId={webTools.pdfPreview?.fileId || ''}
          fileName={webTools.pdfPreview?.fileName || ''}
          page={webTools.pdfPreview?.page || 1}
          downloadPath={webTools.pdfPreview?.downloadPath}
          back={webTools.pdfPreview?.back && {
            trail: webTools.pdfPreview.back.trail,
            onBack: () => { webTools.setShowPdfPreview(false); webTools.pdfPreview?.back?.onBack(); },
          }}
        />}
      </Suspense>

      <Suspense fallback={null}>
        {webTools.mediaPreview && <MediaPreviewModal
          show
          onClose={webTools.closeMediaPreview}
          fileId={webTools.mediaPreview.fileId}
          fileName={webTools.mediaPreview.fileName}
          kind={webTools.mediaPreview.kind}
          userFileId={webTools.mediaPreview.userFileId}
          back={webTools.mediaPreview.back && {
            trail: webTools.mediaPreview.back.trail,
            onBack: () => { webTools.closeMediaPreview(); webTools.mediaPreview?.back?.onBack(); },
          }}
        />}
      </Suspense>

      <Suspense fallback={null}>
        {webTools.showTabularModal && currentKb && <TablePreviewDialog
          show={webTools.showTabularModal}
          onClose={() => webTools.setShowTabularModal(false)}
          kbId={currentKb.id}
          fileId={webTools.tabularFile?.fileId || ''}
          fileName={webTools.tabularFile?.fileName || ''}
          // Live from the polled file list, so the preview loads by itself
          // once an ingest that was still running finishes.
          status={fileMgmt.files.find(f => f.id === webTools.tabularFile?.fileId)?.status}
          back={webTools.tabularFile?.back && {
            trail: webTools.tabularFile.back.trail,
            onBack: () => { webTools.setShowTabularModal(false); webTools.tabularFile?.back?.onBack(); },
          }}
        />}
      </Suspense>
    </>
  );
}

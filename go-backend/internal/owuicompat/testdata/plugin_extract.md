LfAssistant plugin `Stream/OpenWebuiSourceReferencesExtractionStage.php` (branch release_10, commit 35d8bb0): the `onEvent` method that builds the source references.

```php
    public function onEvent(StreamEventInterface $event): void
    {
        if ($event instanceof JsonEvent) {
            $data = $event->getData();
            if (isset($data['sources']) && is_array($data['sources'])) {
                $references = [];
                foreach ($data['sources'] as $source) {
                    $documents = $source['document'] ?? [];
                    $metadatas = $source['metadata'] ?? [];
                    foreach ($documents as $i => $content) {
                        $meta = $metadatas[$i] ?? [];
                        $references[] = $this->data->sourceReference(
                            (string) ($meta['file_id'] ?? ""),
                            (string) ($meta['title'] ?? $meta['name'] ?? ""),
                            (string) ($meta['page_label'] ?? $meta['page'] ?? ""),
                            (string) $content,
                            "",
                            isset($meta['ilias_author'])
                                ? (string) $meta['ilias_author']
                                : null,
                            isset($meta['ilias_publication_date'])
                                ? (string) $meta['ilias_publication_date']
                                : null,
                            isset($meta['ilias_publication_year'])
                                ? (int) $meta['ilias_publication_year']
                                : null
                        );
                    }
                }
                if (!empty($references)) {
                    $this->emitEvent($this->data->sourceReferencesEvent($references));
                }
            }
        }
        $this->emitEvent($event);
    }
```

'use client';
import { useRef, useState } from 'react';
import { Search, Download, X, ArrowRight, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { DropdownSelect } from '@/components/ui/dropdown-select';
import { type ProblemLibrary } from '../../problems/index.ts';

type Entry = {
  assignmentId: string;
  problemId: string;
  title: string;
  steps: number;
  at: string;
};
export function ProblemLibrarySection({
  book,
  onOpen,
  onDelete,
  onExport,
  exporting,
}: {
  book: ProblemLibrary | null;
  onExport: (problemId: string) => void;
  exporting: boolean;
  onOpen: (assignmentId: string, problemId: string) => void;
  onDelete: (assignmentId: string, problemId: string) => Promise<void>;
}) {
  const [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(''),
    [sort, setSort] = useState('recent'),
    [visible, setVisible] = useState(5);
  const [deletion, setDeletion] = useState<Entry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const searchButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const entries: Entry[] =
    book?.assignments.flatMap((a) =>
      a.problems.map((p) => ({
        assignmentId: a.id,
        problemId: p.id,
        title: p.title,
        steps: p.steps.length,
        at: p.steps.at(-1)?.at || '',
      })),
    ) || [];
  const results = entries
    .filter((e) =>
      e.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title, undefined, { numeric: true })
        : sort === 'steps'
          ? b.steps - a.steps
          : b.at.localeCompare(a.at),
    );
  const rows = (items: Entry[]) => (
    <div className="settings-problem-rows">
      {items.map((entry) => (
        <div className="settings-problem-row" key={entry.problemId}>
          <button
            className="problem-open"
            onClick={() => {
              setSearchOpen(false);
              onOpen(entry.assignmentId, entry.problemId);
            }}
          >
            <span>{entry.title}</span>
          </button>
          <button
            className="icon-button"
            aria-label={`Open ${entry.title}`}
            onClick={() => {
              setSearchOpen(false);
              onOpen(entry.assignmentId, entry.problemId);
            }}
          >
            <ArrowRight size={18} />
          </button>
          <button
            className="icon-button"
            aria-label={`Export ${entry.title} as PDF`}
            title={`Export ${entry.title} as PDF`}
            disabled={exporting}
            onClick={() => onExport(entry.problemId)}
          >
            <Download size={18} />
          </button>
          <button
            className="icon-button problem-trash"
            aria-label={`Delete ${entry.title}`}
            title={`Delete ${entry.title}`}
            onClick={() => {
              setDeleteError('');
              setDeletion(entry);
              setDeleteOpen(true);
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
  return (
    <section
      className="settings-section problem-storage"
      aria-labelledby="past-problems-heading"
    >
      <div className="settings-section-heading">
        <div>
          <h2 id="past-problems-heading">Past problems</h2>
        </div>
        <button
          className="icon-button"
          ref={searchButton}
          aria-label="Search problems"
          disabled={!book}
          onClick={() => {
            setQuery('');
            setSearchOpen(true);
          }}
        >
          <Search size={20} />
        </button>
      </div>
      {!book ? (
        <output>Loading problems…</output>
      ) : entries.length ? (
        <>
          {rows(
            [...entries]
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, visible),
          )}
          {entries.length > visible && (
            <button
              className="soft-button"
              onClick={() => setVisible((n) => n + 5)}
            >
              Show more
            </button>
          )}
          {visible > 5 && (
            <button className="text-button" onClick={() => setVisible(5)}>
              Show less
            </button>
          )}
        </>
      ) : (
        <p>No saved problems yet.</p>
      )}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent
          className="problem-search-dialog"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Search problems</DialogTitle>
          <DialogDescription className="sr-only">
            Find saved problems by name.
          </DialogDescription>
          <header className="problem-search-header">
            <Search size={21} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search problems"
              placeholder="Search problems…"
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              className="icon-button"
              aria-label="Close problem search"
              onClick={() => setSearchOpen(false)}
            >
              <X size={22} />
            </button>
          </header>
          <div className="problem-search-filters">
            <DropdownSelect
              label="Sort problems"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'recent', label: 'Most recent' },
                { value: 'title', label: 'Name' },
                { value: 'steps', label: 'Most steps' },
              ]}
            />
          </div>
          <div
            className="problem-search-results"
            aria-label="Problem search results"
          >
            {results.length ? (
              rows(results)
            ) : (
              <p className="search-empty">
                {query.trim()
                  ? `No problems match “${query}”.`
                  : 'No saved problems yet.'}
              </p>
            )}
          </div>
          <output className="problem-result-count">
            {results.length} {results.length === 1 ? 'problem' : 'problems'}
          </output>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteOpen(false);
        }}
      >
        <AlertDialogContent
          className="delete-problem-dialog ring-0"
          initialFocus={cancelButton}
        >
          <AlertDialogTitle>Delete “{deletion?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the problem and all its work. This can’t be undone.
            {entries.length === 1 && ' A new blank problem will open.'}
          </AlertDialogDescription>
          {deleteError && <p role="alert">{deleteError}</p>}
          <div className="delete-problem-actions">
            <button
              ref={cancelButton}
              className="soft-button"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </button>
            <button
              className="soft-button delete-problem-confirm"
              aria-label="Delete problem"
              disabled={deleting}
              aria-busy={deleting}
              onClick={async () => {
                if (!deletion || deleting) return;
                setDeleting(true);
                setDeleteError('');
                try {
                  await onDelete(deletion.assignmentId, deletion.problemId);
                  setDeleteOpen(false);
                  setSearchOpen(false);
                  requestAnimationFrame(() => searchButton.current?.focus());
                } catch {
                  setDeleteError('Couldn’t delete this problem. Try again.');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              <Trash2 size={18} aria-hidden="true" />
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

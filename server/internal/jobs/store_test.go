package jobs

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goodJob = `{"id":"subsplash-links","title":"Subsplash links","updated":"2026-11-11T18:00:00Z",
"checks":["mail","link","live"],
"items":[
 {"label":"Romans 8","date":"2026-11-09","link":"https://example.org/romans-8","done":{"mail":true,"link":true,"live":true}},
 {"label":"Romans 7","date":"2026-11-02","done":{"mail":true,"link":false}},
 {"label":"Romans 6","done":{}}
],
"here":1,"note":"Romans 7 waits on its link"}`

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "jobs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "jobs", name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func logged(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return &buf
}

func TestListSummarisesEachJobWithItsDoneOfTotal(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "subsplash-links.json", goodJob)
	got := Open(dir).List()
	if len(got) != 1 {
		t.Fatalf("List = %+v, want one job", got)
	}
	s := got[0]
	if s.ID != "subsplash-links" || s.Title != "Subsplash links" || s.Updated != "2026-11-11T18:00:00Z" || s.Done != 1 || s.Total != 3 {
		t.Fatalf("summary = %+v, want subsplash-links, 1 of 3", s)
	}
}

func TestAnItemIsDoneWhenEveryCheckIsTrue(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "subsplash-links.json", goodJob)
	j, ok := Open(dir).Get("subsplash-links")
	if !ok {
		t.Fatal("Get found nothing")
	}
	var done []bool
	for _, it := range j.Items {
		done = append(done, j.ItemDone(it))
	}
	if len(done) != 3 || !done[0] || done[1] || done[2] {
		t.Fatalf("done = %v, want [true false false]", done)
	}
	if j.Here == nil || *j.Here != 1 || j.Note != "Romans 7 waits on its link" {
		t.Fatalf("here/note = %v / %q", j.Here, j.Note)
	}
	if len(j.Items) != 3 || j.Items[0].Label != "Romans 8" {
		t.Fatalf("items keep the feed's order: %+v", j.Items)
	}
}

func TestListIsNewestUpdatedFirst(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "a.json", `{"id":"a","title":"A","updated":"2026-11-01T00:00:00Z","checks":["x"],"items":[]}`)
	write(t, dir, "b.json", `{"id":"b","title":"B","updated":"2026-11-05T00:00:00Z","checks":["x"],"items":[]}`)
	got := Open(dir).List()
	if len(got) != 2 || got[0].ID != "b" || got[1].ID != "a" {
		t.Fatalf("List = %+v, want b then a", got)
	}
}

func TestNoJobsDirectoryIsNoJobs(t *testing.T) {
	buf := logged(t)
	if got := Open(t.TempDir()).List(); len(got) != 0 {
		t.Fatalf("List = %+v, want none", got)
	}
	if buf.Len() != 0 {
		t.Fatalf("an absent directory is not worth a log line, got %q", buf.String())
	}
}

func TestABadFileIsSkippedWithALogLine(t *testing.T) {
	buf := logged(t)
	dir := t.TempDir()
	write(t, dir, "good.json", strings.Replace(goodJob, "subsplash-links", "good", 1))
	for name, body := range map[string]string{
		"notjson.json":    `{not json`,
		"wrongid.json":    `{"id":"other","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[]}`,
		"notitle.json":    `{"id":"notitle","title":"","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[]}`,
		"badtime.json":    `{"id":"badtime","title":"T","updated":"yesterday","checks":["a"],"items":[]}`,
		"badcheck.json":   `{"id":"badcheck","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[{"label":"x","done":{"zzz":true}}]}`,
		"badhere.json":    `{"id":"badhere","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[{"label":"x","done":{}}],"here":4}`,
		"badlink.json":    `{"id":"badlink","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[{"label":"x","link":"javascript:alert(1)","done":{}}]}`,
		"nolabel.json":    `{"id":"nolabel","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[{"label":"","done":{}}]}`,
		"dupcheck.json":   `{"id":"dupcheck","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a","a"],"items":[]}`,
		"readme.txt":      `not a job`,
		"UPPER CASE.json": `{}`,
	} {
		write(t, dir, name, body)
	}
	got := Open(dir).List()
	if len(got) != 1 || got[0].ID != "good" {
		t.Fatalf("List = %+v, want only good", got)
	}
	for _, name := range []string{"notjson.json", "wrongid.json", "notitle.json", "badtime.json", "badcheck.json", "badhere.json", "badlink.json", "nolabel.json", "dupcheck.json"} {
		if !strings.Contains(buf.String(), name) {
			t.Errorf("no log line names %s; log:\n%s", name, buf.String())
		}
	}
}

func TestGetRefusesAnIdThatIsNotAJobName(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "good.json", `{"id":"good","title":"T","updated":"2026-11-11T18:00:00Z","checks":["a"],"items":[]}`)
	st := Open(dir)
	for _, id := range []string{"../jobs/good", "good/../good", "", "nope", "GOOD", ".good"} {
		if _, ok := st.Get(id); ok {
			t.Errorf("Get(%q) found a job", id)
		}
	}
	if _, ok := st.Get("good"); !ok {
		t.Error("Get(good) found nothing")
	}
}

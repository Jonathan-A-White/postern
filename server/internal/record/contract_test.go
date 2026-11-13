package record

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
)

// contractFile is Postern's wire contract (docs/fixtures/contract.json), shared
// with the PWA (tests/unit/contract.test.ts) and millwright's copy. It is read
// through a symlink inside this module: go test's cache keys on the files a test
// opens inside the module, so a path straight into docs/ would let an edit to the
// fixture alone pass from the cache.
const contractFile = "testdata/contract.json"

func TestContractMessageClasses(t *testing.T) {
	raw, err := os.ReadFile(contractFile)
	if err != nil {
		t.Fatal(err)
	}
	var contract struct {
		MessageClasses []string `json:"message_classes"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatal(err)
	}
	if len(contract.MessageClasses) == 0 {
		t.Fatal("contract.json lists no message_classes")
	}

	want := map[string]bool{}
	for _, class := range contract.MessageClasses {
		if want[class] {
			t.Errorf("contract.json repeats message class %q", class)
		}
		want[class] = true
	}
	var onlyHere, onlyThere []string
	for class := range MessageClasses {
		if !want[class] {
			onlyHere = append(onlyHere, class)
		}
	}
	for class := range want {
		if !MessageClasses[class] {
			onlyThere = append(onlyThere, class)
		}
	}
	sort.Strings(onlyHere)
	sort.Strings(onlyThere)
	if len(onlyHere) > 0 {
		t.Errorf("record.MessageClasses has classes docs/fixtures/contract.json lacks: %v", onlyHere)
	}
	if len(onlyThere) > 0 {
		t.Errorf("docs/fixtures/contract.json has classes record.MessageClasses lacks: %v", onlyThere)
	}
}

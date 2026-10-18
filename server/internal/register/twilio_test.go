package register

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTwilioSendsAndChecksThroughVerify(t *testing.T) {
	var paths []string
	var forms []map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, _ := r.BasicAuth()
		if user != "ACsid" || pass != "token" {
			t.Errorf("basic auth = %q, %q", user, pass)
		}
		_ = r.ParseForm()
		form := map[string]string{}
		for k := range r.PostForm {
			form[k] = r.PostForm.Get(k)
		}
		paths, forms = append(paths, r.URL.Path), append(forms, form)
		switch {
		case strings.HasSuffix(r.URL.Path, "/Verifications"):
			if form["To"] == "bad" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"status":"pending"}`))
		case form["Code"] == "123456":
			w.Write([]byte(`{"status":"approved","valid":true}`))
		case form["Code"] == "gone":
			w.WriteHeader(http.StatusNotFound)
		default:
			w.Write([]byte(`{"status":"pending","valid":false}`))
		}
	}))
	defer server.Close()

	tw := NewTwilio("ACsid", "token", "VAsvc", WithTwilioBase(server.URL))
	ctx := context.Background()
	if err := tw.Start(ctx, ChannelEmail, "a@x.com"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if paths[0] != "/Services/VAsvc/Verifications" || forms[0]["Channel"] != "email" || forms[0]["To"] != "a@x.com" {
		t.Fatalf("start sent %v %v", paths[0], forms[0])
	}
	if err := tw.Start(ctx, ChannelSMS, "bad"); err != ErrRejected {
		t.Fatalf("a refused address: %v, want ErrRejected", err)
	}
	for code, want := range map[string]bool{"123456": true, "000000": false, "gone": false} {
		got, err := tw.Check(ctx, ChannelSMS, "+14155550101", code)
		if err != nil || got != want {
			t.Errorf("Check(%q) = %v, %v; want %v", code, got, err, want)
		}
	}
}

func TestTwilioErrorsNeverNameTheAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	url := server.URL
	tw := NewTwilio("ACsid", "token", "VAsvc", WithTwilioBase(url))
	err := tw.Start(context.Background(), ChannelEmail, "secret@x.com")
	if err == nil || strings.Contains(err.Error(), "secret@x.com") {
		t.Fatalf("err = %v", err)
	}
	server.Close() // now a connection failure
	err = tw.Start(context.Background(), ChannelEmail, "secret@x.com")
	if err == nil || strings.Contains(err.Error(), "secret@x.com") {
		t.Fatalf("err = %v", err)
	}
}

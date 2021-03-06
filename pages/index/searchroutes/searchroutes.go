package searchroutes

import (
	"github.com/aerogo/layout"
	"github.com/animenotifier/notify.moe/pages/search"
	"github.com/animenotifier/notify.moe/pages/search/multisearch"
)

// Register registers the page routes.
func Register(l *layout.Layout) {
	// Search
	l.Page("/search/*term", search.Get)
	l.Page("/empty-search", search.GetEmptySearch)
	l.Page("/anime-search/*term", search.Anime)
	l.Page("/character-search/*term", search.Characters)
	l.Page("/forum-search/*term", search.Forum)
	l.Page("/soundtrack-search/*term", search.SoundTracks)
	l.Page("/user-search/*term", search.Users)
	l.Page("/company-search/*term", search.Companies)

	// Multi-search
	l.Page("/multisearch/anime", multisearch.Anime)
}

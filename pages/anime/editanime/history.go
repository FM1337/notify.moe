package editanime

import (
	"github.com/animenotifier/arn"
	"github.com/animenotifier/notify.moe/components"
	"github.com/animenotifier/notify.moe/utils/history"
)

// History of the edits.
var History = history.Handler(renderHistory, "Anime", "AnimeCharacters", "AnimeRelations", "AnimeEpisodes")

func renderHistory(obj interface{}, entries []*arn.EditLogEntry, user *arn.User) string {
	return components.EditAnimeTabs(obj.(*arn.Anime)) + components.EditLog(entries, user)
}

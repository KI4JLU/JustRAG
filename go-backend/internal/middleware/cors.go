package middleware

import (
	"net/http"

	"github.com/rs/cors"
)

func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins: allowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		// X-KB-Preview-Role: kbaccess.PreviewRoleHeader, a KB admin's
		// "preview as viewer / editor".
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Request-Id", "X-KB-Preview-Role"},
		ExposedHeaders:   []string{"Content-Disposition"},
		AllowCredentials: true,
		MaxAge:           86400,
	})

	return c.Handler
}

#ifndef TREE_SITTER_HTTP_H_
#define TREE_SITTER_HTTP_H_

typedef struct TSLanguage TSLanguage;

#ifdef __cplusplus
extern "C" {
#endif

const TSLanguage *tree_sitter_http(void);
const TSLanguage *tree_sitter_http_message(void);

#ifdef __cplusplus
}
#endif

#endif // TREE_SITTER_HTTP_H_
